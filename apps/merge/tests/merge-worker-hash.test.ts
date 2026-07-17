import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

vi.mock("comlink", async (importOriginal) => ({
  ...(await importOriginal<typeof import("comlink")>()),
  expose: vi.fn(),
}));

class MockBroadcastChannel {
  addEventListener(): void {}
  postMessage(): void {}
  close(): void {}
}

describe("MergeWorker streaming hashing", () => {
  let MergeWorker: typeof import("../src/workers/osm.worker").MergeWorker;

  beforeAll(async () => {
    vi.stubGlobal("BroadcastChannel", MockBroadcastChannel);
    ({ MergeWorker } = await import("../src/workers/osm.worker"));
  });

  afterAll(() => {
    vi.unstubAllGlobals();
  });

  it("hashes File.stream() without invoking File.arrayBuffer()", async () => {
    const arrayBuffer = vi.fn(() => {
      throw new Error("arrayBuffer() must not be called");
    });
    const stream = vi.fn(() => new Blob([new TextEncoder().encode("abc")]).stream());
    const file = { arrayBuffer, stream } as unknown as File;
    const worker = new MergeWorker();

    const digest = await worker.hashFile(file);

    expect(digest).toBe("ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad");
    expect(digest).toMatch(/^[0-9a-f]{64}$/);
    expect(stream).toHaveBeenCalledOnce();
    expect(arrayBuffer).not.toHaveBeenCalled();
  });

  it("cancels an in-flight file stream by task ID", async () => {
    let chunksProduced = 0;
    let cancelled = false;
    let interval: ReturnType<typeof setInterval> | undefined;
    const arrayBuffer = vi.fn(() => {
      throw new Error("arrayBuffer() must not be called");
    });
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        interval = setInterval(() => {
          chunksProduced++;
          controller.enqueue(new Uint8Array([chunksProduced & 0xff]));
        }, 1);
      },
      cancel() {
        cancelled = true;
        if (interval) clearInterval(interval);
      },
    });
    const file = {
      arrayBuffer,
      stream: vi.fn(() => stream),
    } as unknown as File;
    const worker = new MergeWorker();
    const hashing = worker.hashFile(file, "cancel-me");
    while (chunksProduced < 3) await new Promise((resolve) => setTimeout(resolve, 1));

    worker.cancelHash("cancel-me");

    await expect(hashing).rejects.toMatchObject({ name: "AbortError" });
    expect(cancelled).toBe(true);
    expect(arrayBuffer).not.toHaveBeenCalled();
    const producedAtCancellation = chunksProduced;
    await new Promise((resolve) => setTimeout(resolve, 5));
    expect(chunksProduced).toBe(producedAtCancellation);
  });
});
