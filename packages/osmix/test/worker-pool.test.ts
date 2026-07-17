import { threadId } from "node:worker_threads";

import * as Comlink from "comlink";
import { describe, expect, it, vi } from "vitest";

import {
  createOsmixWorkerConnection,
  createOsmixWorkerPool,
  defaultOsmixWorkerUrl,
  type OsmixWorkerConnection,
  OsmixWorkerPoolDisposedError,
  OsmixWorkerTaskTimeoutError,
  type OsmixWorkerPingTarget,
} from "../src/worker-pool.ts";
import { OsmixWorker } from "../src/worker.ts";

interface TestWorker extends OsmixWorkerPingTarget {
  value: number;
}

interface NodeTestWorker extends OsmixWorkerPingTarget {
  block(milliseconds: number): number;
  crash(): never;
  getThreadId(): number;
  installSharedBuffer(buffer: SharedArrayBuffer): boolean;
  readSharedByte(index: number): number | undefined;
  writeSharedByte(index: number, value: number): void;
}

interface Deferred<T> {
  promise: Promise<T>;
  resolve(value: T): void;
}

function deferred<T>(): Deferred<T> {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((resolvePromise) => {
    resolve = resolvePromise;
  });
  return { promise, resolve };
}

class FakeConnection implements OsmixWorkerConnection<TestWorker> {
  readonly runtime = "in-process" as const;
  readonly remote: Comlink.Remote<TestWorker>;
  readonly terminate = vi.fn(async () => undefined);
  private readonly failureListeners = new Set<(error: Error) => void>();

  constructor(value: number, ping: () => Promise<true> = async () => true) {
    this.remote = {
      ping: vi.fn(ping),
      value: Promise.resolve(value),
      [Comlink.createEndpoint]: vi.fn(),
      [Comlink.releaseProxy]: vi.fn(),
    } as unknown as Comlink.Remote<TestWorker>;
  }

  onFailure(listener: (error: Error) => void): () => void {
    this.failureListeners.add(listener);
    return () => this.failureListeners.delete(listener);
  }

  fail(error = new Error("worker crashed")): void {
    for (const listener of this.failureListeners) listener(error);
  }
}

class FakeWebWorker {
  static latest: FakeWebWorker | undefined;
  readonly terminate = vi.fn();
  private readonly listeners = new Map<string, Set<EventListenerOrEventListenerObject>>();

  constructor() {
    FakeWebWorker.latest = this;
  }

  postMessage(): void {}

  addEventListener(type: string, listener: EventListenerOrEventListenerObject): void {
    const listeners = this.listeners.get(type) ?? new Set();
    listeners.add(listener);
    this.listeners.set(type, listeners);
  }

  removeEventListener(type: string, listener: EventListenerOrEventListenerObject): void {
    this.listeners.get(type)?.delete(listener);
  }

  dispatch(type: string, event: Event): void {
    for (const listener of this.listeners.get(type) ?? []) {
      if ("handleEvent" in listener) listener.handleEvent(event);
      else listener(event);
    }
  }
}

describe("OsmixWorkerPool", () => {
  it.each(["error", "messageerror"] as const)(
    "reports browser Worker %s events as connection failures",
    async (type) => {
      vi.stubGlobal("Worker", FakeWebWorker);
      const connection = await createOsmixWorkerConnection<TestWorker>({
        runtime: "web",
        workerUrl: new URL("https://example.com/test.worker.js"),
      });
      const onFailure = vi.fn();
      connection.onFailure(onFailure);
      const failure = new Error(`${type} failure`);
      const event =
        type === "error" ? ({ error: failure } as ErrorEvent) : ({ data: failure } as MessageEvent);

      FakeWebWorker.latest!.dispatch(type, event as Event);

      await vi.waitFor(() => expect(onFailure).toHaveBeenCalledWith(failure));
      await connection.terminate();
      expect(FakeWebWorker.latest!.terminate).toHaveBeenCalledOnce();
      vi.unstubAllGlobals();
    },
  );

  it.each(["web", "bun", "deno"] as const)(
    "uses the Web Worker transport for the %s runtime",
    async (runtime) => {
      vi.stubGlobal("Worker", FakeWebWorker);
      const connection = await createOsmixWorkerConnection<TestWorker>({
        runtime,
        workerUrl: new URL("https://example.com/test.worker.js"),
      });

      expect(connection.runtime).toBe(runtime);
      await connection.terminate();
      expect(FakeWebWorker.latest!.terminate).toHaveBeenCalledOnce();
      vi.unstubAllGlobals();
    },
  );

  it("reports Bun Worker close events as connection failures", async () => {
    vi.stubGlobal("Worker", FakeWebWorker);
    const connection = await createOsmixWorkerConnection<TestWorker>({
      runtime: "bun",
      workerUrl: new URL("file:///test.worker.js"),
    });
    const onFailure = vi.fn();
    connection.onFailure(onFailure);

    FakeWebWorker.latest!.dispatch("close", { code: 7 } as CloseEvent);

    await vi.waitFor(() =>
      expect(onFailure).toHaveBeenCalledWith(
        expect.objectContaining({ message: "Bun Worker exited unexpectedly with code 7" }),
      ),
    );
    await connection.terminate();
    vi.unstubAllGlobals();
  });

  it("resolves source and built worker siblings when module URLs have cache suffixes", () => {
    expect(
      defaultOsmixWorkerUrl("https://example.com/osmix/worker-runtime.ts?t=123#dev").href,
    ).toBe("https://example.com/osmix/osmix.worker.ts");
    expect(defaultOsmixWorkerUrl("https://example.com/osmix/worker-runtime.js?v=1").href).toBe(
      "https://example.com/osmix/osmix.worker.js",
    );
  });

  it("terminates earlier slots when a later startup probe fails", async () => {
    const first = new FakeConnection(0);
    const failed = new FakeConnection(1, async () => {
      throw new Error("probe failed");
    });
    await expect(
      createOsmixWorkerPool<TestWorker>({
        workerCount: 2,
        createWorker: (index) => [first, failed][index]!,
      }),
    ).rejects.toThrow("probe failed");
    expect(first.terminate).toHaveBeenCalledOnce();
    expect(failed.terminate).toHaveBeenCalledOnce();
  });

  it("caps automatic recovery at one restart per slot", async () => {
    await expect(
      createOsmixWorkerPool<TestWorker>({
        workerCount: 1,
        restartAttempts: 2,
        createWorker: () => new FakeConnection(0),
      }),
    ).rejects.toThrow("restartAttempts cannot exceed one");
  });

  it("uses stable priority/FIFO ordering and keeps eligible idle workers busy", async () => {
    const connections = [new FakeConnection(0), new FakeConnection(1)];
    const pool = await createOsmixWorkerPool<TestWorker>({
      workerCount: 2,
      createWorker: (index) => connections[index]!,
    });
    const gate = deferred<void>();
    const started: string[] = [];
    const busy = pool.runOn(0, async () => {
      started.push("busy");
      await gate.promise;
    });
    await vi.waitFor(() => expect(pool.diagnostics().busyWorkerIndexes).toEqual([0]));

    const pinned = pool.runOn(0, async () => started.push("pinned"), { priority: 100 });
    const available = pool.run(async (_worker, index) => started.push(`available-${index}`));
    await expect(available).resolves.toBe(2);
    expect(started).toEqual(["busy", "available-1"]);

    const low = pool.runOn(0, async () => started.push("low"));
    const highOne = pool.runOn(0, async () => started.push("high-1"), { priority: 10 });
    const highTwo = pool.runOn(0, async () => started.push("high-2"), { priority: 10 });
    gate.resolve();
    await Promise.all([busy, pinned, low, highOne, highTwo]);
    expect(started).toEqual(["busy", "available-1", "pinned", "high-1", "high-2", "low"]);
    await pool.dispose();
  });

  it("matches flexible work away from a slot required by an affinity task", async () => {
    const connections = [new FakeConnection(0), new FakeConnection(1)];
    const pool = await createOsmixWorkerPool<TestWorker>({
      workerCount: 2,
      createWorker: (index) => connections[index]!,
    });
    const flexible = pool.run(async (_worker, index) => index, { priority: 10 });
    const control = pool.runOn(0, async (_worker, index) => index);
    await expect(Promise.all([flexible, control])).resolves.toEqual([1, 0]);
    await pool.dispose();
  });

  it("removes queued aborted work without disturbing the active operation", async () => {
    const connection = new FakeConnection(0);
    const pool = await createOsmixWorkerPool<TestWorker>({
      workerCount: 1,
      createWorker: () => connection,
    });
    const gate = deferred<void>();
    const active = pool.run(async () => gate.promise);
    await vi.waitFor(() => expect(pool.diagnostics().busyWorkerIndexes).toEqual([0]));
    const controller = new AbortController();
    const queued = pool.run(async () => "should not run", { signal: controller.signal });
    expect(pool.diagnostics().queuedTaskCount).toBe(1);
    controller.abort(new Error("stale request"));
    await expect(queued).rejects.toThrow("stale request");
    expect(pool.diagnostics().queuedTaskCount).toBe(0);
    gate.resolve();
    await active;
    await pool.dispose();
  });

  it("restarts, restores, and explicitly retries timed-out work once", async () => {
    const first = new FakeConnection(0);
    const replacement = new FakeConnection(1);
    const connections = [first, replacement];
    const restoreWorker = vi.fn(async () => undefined);
    const pool = await createOsmixWorkerPool<TestWorker>({
      workerCount: 1,
      createWorker: () => connections.shift()!,
      probeTimeoutMs: 50,
      restoreWorker,
    });
    let attempt = 0;
    const result = pool.run(
      async () => {
        if (attempt++ === 0) return new Promise<number>(() => undefined);
        return 42;
      },
      { retry: "once", timeoutMs: 5 },
    );
    await expect(result).resolves.toBe(42);
    expect(first.terminate).toHaveBeenCalledOnce();
    expect(restoreWorker).toHaveBeenCalledWith(replacement.remote, 0, 1);
    expect(pool.diagnostics()).toMatchObject({ restartCount: 1, queuedTaskCount: 0 });
    await pool.dispose();
  });

  it("surfaces a repeated failure after one restart", async () => {
    const first = new FakeConnection(0);
    const replacement = new FakeConnection(1);
    const connections = [first, replacement];
    const pool = await createOsmixWorkerPool<TestWorker>({
      workerCount: 1,
      createWorker: () => connections.shift()!,
      probeTimeoutMs: 50,
    });
    const result = pool.run(async () => new Promise<number>(() => undefined), {
      retry: "once",
      timeoutMs: 5,
    });
    await expect(result).rejects.toBeInstanceOf(OsmixWorkerTaskTimeoutError);
    await vi.waitFor(() => expect(pool.diagnostics().workers[0]?.state).toBe("failed"));
    expect(pool.diagnostics().restartCount).toBe(1);
    expect(first.terminate).toHaveBeenCalledOnce();
    expect(replacement.terminate).toHaveBeenCalledOnce();
    await pool.dispose();
  });

  it("retries worker failures but not ordinary operation errors", async () => {
    const failed = new FakeConnection(0);
    const replacement = new FakeConnection(1);
    const connections = [failed, replacement];
    const pool = await createOsmixWorkerPool<TestWorker>({
      workerCount: 1,
      createWorker: () => connections.shift()!,
    });
    let attempts = 0;
    const recovered = pool.run(
      async () => {
        attempts++;
        if (attempts === 1) {
          queueMicrotask(() => failed.fail());
          return new Promise<number>(() => undefined);
        }
        return 7;
      },
      { retry: "once" },
    );
    await expect(recovered).resolves.toBe(7);
    await expect(
      pool.run(
        async () => {
          throw new Error("invalid request");
        },
        { retry: "once" },
      ),
    ).rejects.toThrow("invalid request");
    expect(attempts).toBe(2);
    expect(pool.diagnostics().restartCount).toBe(1);
    await pool.dispose();
  });

  it("does not retry worker failures unless the operation opts in", async () => {
    const failed = new FakeConnection(0);
    const replacement = new FakeConnection(1);
    const connections = [failed, replacement];
    const pool = await createOsmixWorkerPool<TestWorker>({
      workerCount: 1,
      createWorker: () => connections.shift()!,
    });
    let attempts = 0;
    const result = pool.run(async () => {
      attempts++;
      queueMicrotask(() => failed.fail());
      return new Promise<number>(() => undefined);
    });
    await expect(result).rejects.toThrow("worker crashed");
    await vi.waitFor(() => expect(pool.diagnostics().restartCount).toBe(1));
    expect(attempts).toBe(1);
    await pool.dispose();
  });

  it("recovers an idle worker and withholds its slot until restoration completes", async () => {
    const failed = new FakeConnection(0);
    const replacement = new FakeConnection(1);
    const connections = [failed, replacement];
    const restoreGate = deferred<void>();
    const pool = await createOsmixWorkerPool<TestWorker>({
      workerCount: 1,
      createWorker: () => connections.shift()!,
      restoreWorker: async () => restoreGate.promise,
    });
    failed.fail();
    await vi.waitFor(() => expect(pool.diagnostics().workers[0]?.state).toBe("restarting"));
    let started = false;
    const pending = pool.run(async (_worker, index) => {
      started = true;
      return index;
    });
    await new Promise((resolve) => setTimeout(resolve, 5));
    expect(started).toBe(false);
    restoreGate.resolve();
    await expect(pending).resolves.toBe(0);
    expect(started).toBe(true);
    expect(pool.diagnostics().restartCount).toBe(1);
    await pool.dispose();
  });

  it("bounds restoration and preserves its timeout as the terminal slot error", async () => {
    const failed = new FakeConnection(0);
    const replacement = new FakeConnection(1);
    const connections = [failed, replacement];
    const pool = await createOsmixWorkerPool<TestWorker>({
      workerCount: 1,
      createWorker: () => connections.shift()!,
      restoreTimeoutMs: 5,
      restoreWorker: async () => new Promise<void>(() => undefined),
    });
    failed.fail();
    const pending = pool.run(async () => 1);
    await expect(pending).rejects.toBeInstanceOf(OsmixWorkerTaskTimeoutError);
    expect(pool.diagnostics().workers[0]?.state).toBe("failed");
    await pool.dispose();
  });

  it("surfaces the exact restoration failure to queued work", async () => {
    const failed = new FakeConnection(0);
    const replacement = new FakeConnection(1);
    const recoveryError = new Error("durable dataset is unavailable");
    const connections = [failed, replacement];
    const pool = await createOsmixWorkerPool<TestWorker>({
      workerCount: 1,
      createWorker: () => connections.shift()!,
      restoreWorker: async () => {
        throw recoveryError;
      },
    });
    failed.fail();
    const pending = pool.run(async () => 1);
    await expect(pending).rejects.toBe(recoveryError);
    await pool.dispose();
  });

  it("does not hang when a replacement worker fails during restoration", async () => {
    const failed = new FakeConnection(0);
    const replacement = new FakeConnection(1);
    const connections = [failed, replacement];
    const pool = await createOsmixWorkerPool<TestWorker>({
      workerCount: 1,
      createWorker: () => connections.shift()!,
      restoreWorker: () => {
        queueMicrotask(() => replacement.fail(new Error("restore crashed")));
      },
    });
    const result = pool.run(
      async () => {
        queueMicrotask(() => failed.fail());
        return new Promise<number>(() => undefined);
      },
      { retry: "once" },
    );
    await expect(result).rejects.toThrow("restore crashed");
    expect(pool.diagnostics().workers[0]?.state).toBe("failed");
    await pool.dispose();
  });

  it("broadcasts in worker-index order and offers a deprecated unmanaged escape hatch", async () => {
    const connections = [new FakeConnection(0), new FakeConnection(1), new FakeConnection(2)];
    const pool = await createOsmixWorkerPool<TestWorker>({
      workerCount: 3,
      createWorker: (index) => connections[index]!,
    });
    await expect(pool.broadcast(async (_worker, index) => index)).resolves.toEqual([0, 1, 2]);
    await expect(
      pool.broadcast(async (_worker, index) => index, { eligibleWorkerIndexes: [1, 2] }),
    ).resolves.toEqual([1, 2]);
    expect(pool.getUnmanagedWorker()).toBe(connections[0]!.remote);
    expect(pool.getUnmanagedWorker()).toBe(connections[1]!.remote);
    expect(pool.getUnmanagedWorker(2)).toBe(connections[2]!.remote);
    await pool.dispose();
  });

  it("disposes queued/running work and connections idempotently", async () => {
    const connection = new FakeConnection(0);
    const pool = await createOsmixWorkerPool<TestWorker>({
      workerCount: 1,
      createWorker: () => connection,
    });
    const running = pool.run(async () => new Promise<void>(() => undefined));
    const queued = pool.run(async () => undefined);
    await vi.waitFor(() => expect(pool.diagnostics().busyWorkerIndexes).toEqual([0]));
    await Promise.all([pool.dispose(), pool.dispose()]);
    await expect(running).rejects.toBeInstanceOf(OsmixWorkerPoolDisposedError);
    await expect(queued).rejects.toBeInstanceOf(OsmixWorkerPoolDisposedError);
    expect(connection.terminate).toHaveBeenCalledOnce();
    expect(pool.diagnostics()).toMatchObject({ disposed: true, queuedTaskCount: 0 });
  });

  it("does not resurrect a slot when running work settles after disposal", async () => {
    const connection = new FakeConnection(0);
    const gate = deferred<void>();
    const pool = await createOsmixWorkerPool<TestWorker>({
      workerCount: 1,
      createWorker: () => connection,
    });
    const running = pool.run(async () => gate.promise);
    await vi.waitFor(() => expect(pool.diagnostics().busyWorkerIndexes).toEqual([0]));
    await pool.dispose();
    await expect(running).rejects.toBeInstanceOf(OsmixWorkerPoolDisposedError);
    gate.resolve();
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(pool.diagnostics().workers[0]?.state).toBe("disposed");
  });

  it("does not finish disposal until a delayed replacement is created and terminated", async () => {
    const failed = new FakeConnection(0);
    const replacement = new FakeConnection(1);
    const replacementReady = deferred<OsmixWorkerConnection<TestWorker>>();
    let createCount = 0;
    const pool = await createOsmixWorkerPool<TestWorker>({
      workerCount: 1,
      createWorker: () => (createCount++ === 0 ? failed : replacementReady.promise),
    });
    failed.fail();
    await vi.waitFor(() => expect(createCount).toBe(2));
    let disposed = false;
    const disposal = pool.dispose().then(() => {
      disposed = true;
    });
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(disposed).toBe(false);
    replacementReady.resolve(replacement);
    await disposal;
    expect(replacement.terminate).toHaveBeenCalledOnce();
    expect(disposed).toBe(true);
    expect(pool.diagnostics().workers[0]?.state).toBe("disposed");
  });
});

describe("Node worker runtime", () => {
  it("keeps explicit in-process execution blocking and disposal idempotent", async () => {
    const worker = new OsmixWorker();
    const pool = await createOsmixWorkerPool({
      inProcess: true,
      createInProcessWorker: () => worker,
      workerCount: 1,
    });
    expect(await pool.run((remote) => remote.ping())).toBe(true);
    await Promise.all([pool.dispose(), pool.dispose()]);
    expect(pool.diagnostics().disposed).toBe(true);
  });

  it("runs real worker threads without blocking the caller event loop", async () => {
    const pool = await createOsmixWorkerPool<NodeTestWorker>({
      workerCount: 2,
      workerUrl: new URL("./fixtures/pool.worker.mjs", import.meta.url),
      runtime: "node",
    });
    try {
      const workerThreadIds = await pool.broadcast((worker) => worker.getThreadId());
      expect(new Set(workerThreadIds).size).toBe(2);
      expect(workerThreadIds).not.toContain(threadId);

      let timerFired = false;
      const timer = setTimeout(() => {
        timerFired = true;
      }, 5);
      await pool.run((worker) => worker.block(50));
      clearTimeout(timer);
      expect(timerFired).toBe(true);
    } finally {
      await pool.dispose();
    }
  });

  it("shares one backing buffer across real Node worker slots", async () => {
    const pool = await createOsmixWorkerPool<NodeTestWorker>({
      workerCount: 2,
      workerUrl: new URL("./fixtures/pool.worker.mjs", import.meta.url),
      runtime: "node",
    });
    try {
      const buffer = new SharedArrayBuffer(4);
      const local = new Uint8Array(buffer);
      await expect(pool.broadcast((worker) => worker.installSharedBuffer(buffer))).resolves.toEqual(
        [true, true],
      );
      await pool.runOn(0, (worker) => worker.writeSharedByte(0, 37));
      await expect(pool.runOn(1, (worker) => worker.readSharedByte(0))).resolves.toBe(37);
      expect(local[0]).toBe(37);
    } finally {
      await pool.dispose();
    }
  });

  it("restarts a crashed Node worker and runs the explicit retry after restoration", async () => {
    const restoreWorker = vi.fn(async () => undefined);
    const pool = await createOsmixWorkerPool<NodeTestWorker>({
      workerCount: 1,
      workerUrl: new URL("./fixtures/pool.worker.mjs", import.meta.url),
      runtime: "node",
      restoreWorker,
    });
    try {
      let attempts = 0;
      const result = pool.run(
        (worker) => (attempts++ === 0 ? worker.crash() : worker.getThreadId()),
        { retry: "once", timeoutMs: 2_000 },
      );
      await expect(result).resolves.toBeGreaterThan(0);
      expect(restoreWorker).toHaveBeenCalledOnce();
      expect(pool.diagnostics().restartCount).toBe(1);
    } finally {
      await pool.dispose();
    }
  });
});
