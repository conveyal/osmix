/** Availability-aware, fault-tolerant scheduling for Osmix workers. */

import type * as Comlink from "comlink";

import { getOsmixCapabilities, type WorkerRuntime } from "./capabilities.ts";
import { createOsmixWorkerConnection, type OsmixWorkerConnection } from "./worker-runtime.ts";
import { OsmixWorker } from "./worker.ts";

export type MaybePromise<T> = T | PromiseLike<T>;
export type WorkerTaskRetry = "never" | "once";

/** Minimum interface required by the pool's startup probe. */
export interface OsmixWorkerPingTarget {
  ping(): true | Promise<true>;
}

/** A unit of work run against one managed worker proxy. */
export type OsmixWorkerPoolTask<T extends OsmixWorkerPingTarget, R> = (
  worker: Comlink.Remote<T>,
  workerIndex: number,
) => MaybePromise<R>;

/** Per-operation scheduling and fault policy. */
export interface OsmixWorkerPoolRunOptions {
  /** Restrict execution to these worker indexes. Defaults to every worker. */
  eligibleWorkerIndexes?: readonly number[];
  /** Higher values run first. Equal priorities retain FIFO order. */
  priority?: number;
  /** Reject and restart the worker when execution exceeds this duration. */
  timeoutMs?: number;
  /** Retry once after a worker failure or timeout. Defaults to `never`. */
  retry?: WorkerTaskRetry;
  /** Remove queued work immediately; running RPCs settle in the background. */
  signal?: AbortSignal;
}

export interface OsmixWorkerPoolWorkerDiagnostics {
  index: number;
  runtime: WorkerRuntime | "in-process";
  state: "idle" | "busy" | "restarting" | "failed" | "disposed";
  restartCount: number;
}

export interface OsmixWorkerPoolDiagnostics {
  workerCount: number;
  queuedTaskCount: number;
  idleWorkerIndexes: number[];
  busyWorkerIndexes: number[];
  restartCount: number;
  disposed: boolean;
  workers: OsmixWorkerPoolWorkerDiagnostics[];
}

/** Construction and recovery hooks for a managed worker pool. */
export interface OsmixWorkerPoolOptions<T extends OsmixWorkerPingTarget = OsmixWorker> {
  /** Defaults to `getOsmixCapabilities().maxWorkers`. */
  workerCount?: number;
  /** Custom entrypoint for an `OsmixWorker` subclass. */
  workerUrl?: URL;
  /** Force a worker implementation; `auto` selects browser or Node workers. */
  runtime?: WorkerRuntime | "auto";
  /** Run one worker directly on the calling thread. */
  inProcess?: boolean;
  /** Construct a custom in-process implementation. */
  createInProcessWorker?: () => T;
  /** Deterministic/custom worker construction seam. */
  createWorker?: (workerIndex: number) => MaybePromise<OsmixWorkerConnection<T>>;
  /** Restore application state after a restarted worker passes its probe. */
  restoreWorker?: (
    worker: Comlink.Remote<T>,
    workerIndex: number,
    restartAttempt: number,
  ) => MaybePromise<void>;
  /** Restart attempts per slot. Defaults to 1. */
  restartAttempts?: number;
  /** Timeout for startup and restart probes. Defaults to 10 seconds. */
  probeTimeoutMs?: number;
  /** Timeout for restoring a restarted slot. Defaults to the probe timeout. */
  restoreTimeoutMs?: number;
}

export class OsmixWorkerPoolDisposedError extends Error {
  constructor() {
    super("The Osmix worker pool has been disposed");
    this.name = "OsmixWorkerPoolDisposedError";
  }
}

export class OsmixWorkerUnavailableError extends Error {
  readonly workerIndexes: readonly number[];

  constructor(workerIndexes: readonly number[]) {
    super(`No healthy worker is available among indexes: ${workerIndexes.join(", ")}`);
    this.name = "OsmixWorkerUnavailableError";
    this.workerIndexes = workerIndexes;
  }
}

export class OsmixWorkerTaskTimeoutError extends Error {
  readonly workerIndex: number;
  readonly timeoutMs: number;

  constructor(workerIndex: number, timeoutMs: number) {
    super(`Worker ${workerIndex} operation timed out after ${timeoutMs} ms`);
    this.name = "OsmixWorkerTaskTimeoutError";
    this.workerIndex = workerIndex;
    this.timeoutMs = timeoutMs;
  }
}

class OsmixWorkerConnectionError extends Error {
  override readonly cause: Error;

  constructor(workerIndex: number, cause: Error) {
    super(`Worker ${workerIndex} failed: ${cause.message}`);
    this.name = "OsmixWorkerConnectionError";
    this.cause = cause;
  }
}

interface Deferred<T> {
  promise: Promise<T>;
  resolve(value: T): void;
  reject(reason: unknown): void;
}

function deferred<T>(): Deferred<T> {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

interface PoolJob<T extends OsmixWorkerPingTarget> {
  sequence: number;
  task: OsmixWorkerPoolTask<T, unknown>;
  eligibleWorkerIndexes: readonly number[];
  priority: number;
  timeoutMs?: number;
  retry: WorkerTaskRetry;
  retryCount: number;
  signal?: AbortSignal;
  abortListener?: () => void;
  callerSettled: boolean;
  resolve(value: unknown): void;
  reject(reason: unknown): void;
}

type SlotState = OsmixWorkerPoolWorkerDiagnostics["state"];

interface WorkerSlot<T extends OsmixWorkerPingTarget> {
  index: number;
  connection: OsmixWorkerConnection<T>;
  state: SlotState;
  restartCount: number;
  generation: number;
  removeFailureListener: () => void;
  failure: Deferred<never>;
  failureError?: OsmixWorkerConnectionError;
  terminalError?: unknown;
  currentJob?: PoolJob<T>;
  recovery?: Promise<void>;
}

const DEFAULT_PROBE_TIMEOUT_MS = 10_000;

function validatePositiveInteger(value: number, label: string): void {
  if (!Number.isInteger(value) || value < 1) throw new Error(`${label} must be at least 1`);
}

function validateNonNegativeInteger(value: number, label: string): void {
  if (!Number.isInteger(value) || value < 0) {
    throw new Error(`${label} must be a non-negative integer`);
  }
}

function abortReason(signal: AbortSignal): unknown {
  return signal.reason ?? new DOMException("The operation was aborted", "AbortError");
}

function withTimeout<T>(promise: PromiseLike<T>, timeoutMs: number, error: Error): Promise<T> {
  if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) {
    return Promise.reject(new Error("timeoutMs must be greater than 0"));
  }
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(error), timeoutMs);
    Promise.resolve(promise).then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (reason) => {
        clearTimeout(timer);
        reject(reason);
      },
    );
  });
}

/**
 * Availability-aware worker scheduler. Construct with `createOsmixWorkerPool()`
 * so startup probes finish before work can be queued.
 */
export class OsmixWorkerPool<T extends OsmixWorkerPingTarget = OsmixWorker>
  implements Disposable, AsyncDisposable
{
  private readonly options: Required<
    Pick<OsmixWorkerPoolOptions<T>, "restartAttempts" | "probeTimeoutMs" | "restoreTimeoutMs">
  > &
    Omit<OsmixWorkerPoolOptions<T>, "restartAttempts" | "probeTimeoutMs" | "restoreTimeoutMs">;
  private readonly slots: WorkerSlot<T>[] = [];
  private readonly queue: PoolJob<T>[] = [];
  private sequence = 0;
  private unmanagedWorkerCursor = 0;
  private pumpScheduled = false;
  private disposed = false;
  private disposePromise?: Promise<void>;

  private constructor(options: OsmixWorkerPoolOptions<T>) {
    this.options = {
      ...options,
      restartAttempts: options.restartAttempts ?? 1,
      probeTimeoutMs: options.probeTimeoutMs ?? DEFAULT_PROBE_TIMEOUT_MS,
      restoreTimeoutMs:
        options.restoreTimeoutMs ?? options.probeTimeoutMs ?? DEFAULT_PROBE_TIMEOUT_MS,
    };
  }

  static async create<T extends OsmixWorkerPingTarget = OsmixWorker>(
    options: OsmixWorkerPoolOptions<T> = {},
  ): Promise<OsmixWorkerPool<T>> {
    const pool = new OsmixWorkerPool(options);
    await pool.initialize();
    return pool;
  }

  /** Number of configured worker slots, including a failed slot. */
  get workerCount(): number {
    return this.slots.length;
  }

  /** Stable indexes for every configured worker slot. */
  get workerIndexes(): readonly number[] {
    return this.slots.map((slot) => slot.index);
  }

  private async initialize(): Promise<void> {
    const workerCount = this.options.workerCount ?? getOsmixCapabilities().maxWorkers;
    validatePositiveInteger(workerCount, "Worker count");
    validateNonNegativeInteger(this.options.restartAttempts, "restartAttempts");
    if (this.options.restartAttempts > 1) {
      throw new Error("restartAttempts cannot exceed one");
    }
    if (this.options.inProcess && workerCount !== 1) {
      throw new Error("In-process mode supports exactly one worker");
    }
    if (this.options.inProcess && this.options.workerUrl) {
      throw new Error("workerUrl cannot be used in in-process mode");
    }
    const results = await Promise.allSettled(
      Array.from({ length: workerCount }, (_, index) => this.createSlot(index, 0)),
    );
    for (const result of results) {
      if (result.status === "fulfilled") this.slots.push(result.value);
    }
    const failure = results.find((result) => result.status === "rejected");
    if (failure?.status === "rejected") {
      await this.dispose();
      throw failure.reason;
    }
  }

  private async createConnection(index: number): Promise<OsmixWorkerConnection<T>> {
    if (this.options.createWorker) return this.options.createWorker(index);
    if (this.options.inProcess) {
      const worker = this.options.createInProcessWorker?.() ?? (new OsmixWorker() as unknown as T);
      return createOsmixWorkerConnection({ inProcessWorker: worker });
    }
    return createOsmixWorkerConnection<T>({
      workerUrl: this.options.workerUrl,
      runtime: this.options.runtime,
    });
  }

  private async createSlot(index: number, restartCount: number): Promise<WorkerSlot<T>> {
    const connection = await this.createConnection(index);
    const slot: WorkerSlot<T> = {
      index,
      connection,
      state: "restarting",
      restartCount,
      generation: 0,
      removeFailureListener: () => undefined,
      failure: deferred<never>(),
    };
    // A failure can occur while the slot is idle, with no operation racing this promise.
    slot.failure.promise.catch(() => undefined);
    this.attachFailureListener(slot);
    try {
      const ready = await withTimeout(
        Promise.race([connection.remote.ping(), slot.failure.promise]),
        this.options.probeTimeoutMs,
        new OsmixWorkerTaskTimeoutError(index, this.options.probeTimeoutMs),
      );
      if (slot.failureError) throw slot.failureError;
      if (ready !== true) throw new Error(`Worker ${index} returned an invalid probe response`);
      if (restartCount > 0 && this.options.restoreWorker) {
        await withTimeout(
          Promise.race([
            this.options.restoreWorker(connection.remote, index, restartCount),
            slot.failure.promise,
          ]),
          this.options.restoreTimeoutMs,
          new OsmixWorkerTaskTimeoutError(index, this.options.restoreTimeoutMs),
        );
      }
      if (slot.failureError) throw slot.failureError;
      slot.state = "idle";
      return slot;
    } catch (error) {
      slot.removeFailureListener();
      await connection.terminate();
      throw error;
    }
  }

  private attachFailureListener(slot: WorkerSlot<T>): void {
    const generation = slot.generation;
    slot.removeFailureListener = slot.connection.onFailure((error) => {
      if (this.disposed || slot.generation !== generation) return;
      const failureError = new OsmixWorkerConnectionError(slot.index, error);
      slot.failureError = failureError;
      slot.failure.reject(failureError);
      if (slot.state === "idle") void this.recoverSlot(slot);
    });
  }

  /** Queue one operation for the highest-priority eligible available worker. */
  run<R>(task: OsmixWorkerPoolTask<T, R>, options: OsmixWorkerPoolRunOptions = {}): Promise<R> {
    if (this.disposed) return Promise.reject(new OsmixWorkerPoolDisposedError());
    const eligibleWorkerIndexes = this.normalizeEligibleIndexes(options.eligibleWorkerIndexes);
    if (
      options.timeoutMs !== undefined &&
      (!Number.isFinite(options.timeoutMs) || options.timeoutMs <= 0)
    ) {
      return Promise.reject(new Error("timeoutMs must be greater than 0"));
    }
    if (options.signal?.aborted) return Promise.reject(abortReason(options.signal));

    return new Promise<R>((resolve, reject) => {
      const job: PoolJob<T> = {
        sequence: this.sequence++,
        task: task as OsmixWorkerPoolTask<T, unknown>,
        eligibleWorkerIndexes,
        priority: options.priority ?? 0,
        timeoutMs: options.timeoutMs,
        retry: options.retry ?? "never",
        retryCount: 0,
        signal: options.signal,
        callerSettled: false,
        resolve: (value) => resolve(value as R),
        reject,
      };
      if (job.signal) {
        job.abortListener = () => this.abortJob(job);
        job.signal.addEventListener("abort", job.abortListener, { once: true });
      }
      this.queue.push(job);
      this.schedulePump();
    });
  }

  /** Queue one operation on a specific worker slot. */
  runOn<R>(
    workerIndex: number,
    task: OsmixWorkerPoolTask<T, R>,
    options: Omit<OsmixWorkerPoolRunOptions, "eligibleWorkerIndexes"> = {},
  ): Promise<R> {
    return this.run(task, { ...options, eligibleWorkerIndexes: [workerIndex] });
  }

  /** Run an operation once on every selected worker, returning results in index order. */
  broadcast<R>(
    task: OsmixWorkerPoolTask<T, R>,
    options: OsmixWorkerPoolRunOptions = {},
  ): Promise<R[]> {
    const indexes = this.normalizeEligibleIndexes(options.eligibleWorkerIndexes);
    const runOptions = { ...options };
    delete runOptions.eligibleWorkerIndexes;
    return Promise.all(indexes.map((index) => this.runOn(index, task, runOptions)));
  }

  /**
   * Access a raw proxy without reserving its slot. Prefer `run()` for managed work.
   * When omitted, the index advances round-robin across healthy workers.
   */
  getUnmanagedWorker(workerIndex?: number): Comlink.Remote<T> {
    if (this.disposed) throw new OsmixWorkerPoolDisposedError();
    if (workerIndex !== undefined) {
      const slot = this.slots[workerIndex];
      if (
        !slot ||
        slot.state === "failed" ||
        slot.state === "disposed" ||
        slot.state === "restarting"
      ) {
        throw new OsmixWorkerUnavailableError([workerIndex]);
      }
      return slot.connection.remote;
    }
    for (let offset = 0; offset < this.slots.length; offset++) {
      const index = (this.unmanagedWorkerCursor + offset) % this.slots.length;
      const slot = this.slots[index]!;
      if (slot.state === "failed" || slot.state === "disposed" || slot.state === "restarting") {
        continue;
      }
      this.unmanagedWorkerCursor = (index + 1) % this.slots.length;
      return slot.connection.remote;
    }
    throw new OsmixWorkerUnavailableError(this.workerIndexes);
  }

  diagnostics(): OsmixWorkerPoolDiagnostics {
    const workers = this.slots.map<OsmixWorkerPoolWorkerDiagnostics>((slot) => ({
      index: slot.index,
      runtime: slot.connection.runtime,
      state: slot.state,
      restartCount: slot.restartCount,
    }));
    return {
      workerCount: workers.length,
      queuedTaskCount: this.queue.length,
      idleWorkerIndexes: workers
        .filter((worker) => worker.state === "idle")
        .map(({ index }) => index),
      busyWorkerIndexes: workers
        .filter((worker) => worker.state === "busy")
        .map(({ index }) => index),
      restartCount: workers.reduce((sum, worker) => sum + worker.restartCount, 0),
      disposed: this.disposed,
      workers,
    };
  }

  private normalizeEligibleIndexes(indexes?: readonly number[]): readonly number[] {
    const selected: number[] = indexes ? [...new Set(indexes)] : [...this.workerIndexes];
    if (selected.length === 0) throw new Error("At least one eligible worker index is required");
    for (const index of selected) {
      if (!Number.isInteger(index) || index < 0 || index >= this.slots.length) {
        throw new RangeError(`Worker index ${index} is outside the pool`);
      }
    }
    return selected.sort((a, b) => a - b);
  }

  private abortJob(job: PoolJob<T>): void {
    if (job.callerSettled) return;
    job.callerSettled = true;
    const queuedIndex = this.queue.indexOf(job);
    if (queuedIndex !== -1) this.queue.splice(queuedIndex, 1);
    this.removeAbortListener(job);
    job.reject(job.signal ? abortReason(job.signal) : new DOMException("Aborted", "AbortError"));
    this.schedulePump();
  }

  private removeAbortListener(job: PoolJob<T>): void {
    if (job.signal && job.abortListener) {
      job.signal.removeEventListener("abort", job.abortListener);
      job.abortListener = undefined;
    }
  }

  private schedulePump(): void {
    if (this.disposed || this.pumpScheduled) return;
    this.pumpScheduled = true;
    queueMicrotask(() => {
      this.pumpScheduled = false;
      this.pump();
    });
  }

  private pump(): void {
    if (this.disposed) return;
    const idleSlots = this.slots.filter((slot) => slot.state === "idle");
    const jobs = [...this.queue].sort((a, b) => b.priority - a.priority || a.sequence - b.sequence);
    const assignments = new Map<number, PoolJob<T>>();
    const assign = (job: PoolJob<T>, visited: Set<number>): boolean => {
      for (const slot of idleSlots) {
        if (!job.eligibleWorkerIndexes.includes(slot.index) || visited.has(slot.index)) continue;
        visited.add(slot.index);
        const occupyingJob = assignments.get(slot.index);
        if (occupyingJob && !assign(occupyingJob, visited)) continue;
        assignments.set(slot.index, job);
        return true;
      }
      return false;
    };
    for (const job of jobs) assign(job, new Set());

    const scheduled = new Set(assignments.values());
    for (let index = this.queue.length - 1; index >= 0; index--) {
      if (scheduled.has(this.queue[index]!)) this.queue.splice(index, 1);
    }
    for (const slot of idleSlots) {
      const job = assignments.get(slot.index);
      if (job) void this.execute(slot, job);
    }
    this.rejectUnserviceableJobs();
  }

  private async execute(slot: WorkerSlot<T>, job: PoolJob<T>): Promise<void> {
    if (job.callerSettled) {
      this.schedulePump();
      return;
    }
    slot.state = "busy";
    slot.currentJob = job;
    const generation = slot.generation;
    const operation = Promise.resolve().then(() => job.task(slot.connection.remote, slot.index));
    // A rejected operation after an abort/failure must never become unhandled.
    operation.catch(() => undefined);
    let result: unknown;
    let error: unknown;
    let rejected = false;
    try {
      const pending = Promise.race([operation, slot.failure.promise]);
      result = job.timeoutMs
        ? await withTimeout(
            pending,
            job.timeoutMs,
            new OsmixWorkerTaskTimeoutError(slot.index, job.timeoutMs),
          )
        : await pending;
    } catch (reason) {
      error = reason;
      rejected = true;
    }

    if (this.disposed || slot.generation !== generation) return;
    slot.currentJob = undefined;
    const workerFailed =
      error instanceof OsmixWorkerConnectionError || error instanceof OsmixWorkerTaskTimeoutError;
    if (workerFailed) {
      if (!job.callerSettled && job.retry === "once" && job.retryCount === 0) {
        job.retryCount++;
        job.sequence = this.sequence++;
        this.queue.push(job);
      } else if (!job.callerSettled) {
        job.callerSettled = true;
        this.removeAbortListener(job);
        job.reject(error);
      }
      void this.recoverSlot(slot);
      this.schedulePump();
      return;
    }

    slot.state = "idle";
    if (!job.callerSettled) {
      job.callerSettled = true;
      this.removeAbortListener(job);
      if (!rejected) job.resolve(result);
      else job.reject(error);
    }
    this.schedulePump();
  }

  private recoverSlot(slot: WorkerSlot<T>): Promise<void> {
    if (slot.recovery) return slot.recovery;
    slot.recovery = this.performRecovery(slot).finally(() => {
      slot.recovery = undefined;
    });
    return slot.recovery;
  }

  private async performRecovery(slot: WorkerSlot<T>): Promise<void> {
    if (this.disposed || slot.state === "disposed") return;
    slot.state = "restarting";
    const generation = ++slot.generation;
    slot.removeFailureListener();
    await slot.connection.terminate().catch(() => undefined);
    if (this.disposed || slot.generation !== generation) return;
    if (slot.restartCount >= this.options.restartAttempts) {
      slot.terminalError ??= slot.failureError;
      slot.state = "failed";
      this.rejectUnserviceableJobs();
      return;
    }
    const restartCount = slot.restartCount + 1;
    try {
      const connection = await this.createConnection(slot.index);
      if (this.disposed || slot.generation !== generation) {
        await connection.terminate().catch(() => undefined);
        return;
      }
      slot.connection = connection;
      slot.restartCount = restartCount;
      slot.failure = deferred<never>();
      slot.failureError = undefined;
      slot.terminalError = undefined;
      slot.failure.promise.catch(() => undefined);
      this.attachFailureListener(slot);
      const ready = await withTimeout(
        Promise.race([connection.remote.ping(), slot.failure.promise]),
        this.options.probeTimeoutMs,
        new OsmixWorkerTaskTimeoutError(slot.index, this.options.probeTimeoutMs),
      );
      if (this.disposed || slot.generation !== generation) return;
      if (slot.failureError) throw slot.failureError;
      if (ready !== true)
        throw new Error(`Worker ${slot.index} returned an invalid probe response`);
      if (this.options.restoreWorker) {
        await withTimeout(
          Promise.race([
            this.options.restoreWorker(connection.remote, slot.index, restartCount),
            slot.failure.promise,
          ]),
          this.options.restoreTimeoutMs,
          new OsmixWorkerTaskTimeoutError(slot.index, this.options.restoreTimeoutMs),
        );
      }
      if (this.disposed || slot.generation !== generation) return;
      if (slot.failureError) throw slot.failureError;
      slot.state = "idle";
      this.schedulePump();
    } catch (error) {
      if (this.disposed || slot.generation !== generation) return;
      slot.removeFailureListener();
      await slot.connection.terminate().catch(() => undefined);
      if (this.disposed || slot.generation !== generation) return;
      slot.restartCount = restartCount;
      slot.terminalError = error;
      slot.state = "failed";
      this.rejectUnserviceableJobs();
    }
  }

  private rejectUnserviceableJobs(): void {
    for (let index = this.queue.length - 1; index >= 0; index--) {
      const job = this.queue[index]!;
      const canRecover = job.eligibleWorkerIndexes.some((workerIndex) => {
        const state = this.slots[workerIndex]?.state;
        return state !== "failed" && state !== "disposed";
      });
      if (canRecover) continue;
      this.queue.splice(index, 1);
      if (!job.callerSettled) {
        job.callerSettled = true;
        this.removeAbortListener(job);
        const terminalError = job.eligibleWorkerIndexes
          .map((workerIndex) => this.slots[workerIndex]?.terminalError)
          .find((error) => error !== undefined);
        job.reject(terminalError ?? new OsmixWorkerUnavailableError(job.eligibleWorkerIndexes));
      }
    }
  }

  /** Dispose queued work and terminate every worker. Safe to call repeatedly. */
  dispose(): Promise<void> {
    if (this.disposePromise) return this.disposePromise;
    this.disposed = true;
    const error = new OsmixWorkerPoolDisposedError();
    const recoveries = this.slots.flatMap((slot) => (slot.recovery ? [slot.recovery] : []));
    for (const job of this.queue.splice(0)) {
      if (!job.callerSettled) {
        job.callerSettled = true;
        this.removeAbortListener(job);
        job.reject(error);
      }
    }
    for (const slot of this.slots) {
      const job = slot.currentJob;
      if (job && !job.callerSettled) {
        job.callerSettled = true;
        this.removeAbortListener(job);
        job.reject(error);
      }
      slot.currentJob = undefined;
      slot.state = "disposed";
      slot.generation++;
      slot.removeFailureListener();
      slot.failure.reject(error);
    }
    this.disposePromise = Promise.all([
      ...this.slots.map((slot) => slot.connection.terminate().catch(() => undefined)),
      ...recoveries,
    ]).then(() => undefined);
    return this.disposePromise;
  }

  [Symbol.dispose](): void {
    void this.dispose();
  }

  async [Symbol.asyncDispose](): Promise<void> {
    await this.dispose();
  }
}

/** Create and probe every slot in an `OsmixWorkerPool`. */
export function createOsmixWorkerPool<T extends OsmixWorkerPingTarget = OsmixWorker>(
  options: OsmixWorkerPoolOptions<T> = {},
): Promise<OsmixWorkerPool<T>> {
  return OsmixWorkerPool.create(options);
}

export {
  createOsmixWorkerConnection,
  defaultOsmixWorkerUrl,
  exposeOsmixWorker,
  type CreateOsmixWorkerConnectionOptions,
  type OsmixWorkerConnection,
  type WorkerConnectionRuntime,
} from "./worker-runtime.ts";
