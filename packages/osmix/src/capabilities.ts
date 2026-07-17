/**
 * Runtime capability detection for Osmix worker orchestration.
 *
 * All checks are evaluated at call time (never at module load) so importing
 * `osmix` is side-effect free and safe in every runtime, including Node 20
 * where the `navigator` global does not exist.
 *
 * @module
 */

import { supportsReadableStreamTransfer } from "./utils.ts";

/**
 * How an `OsmixRemote` runs its workload.
 * - `multi-worker`: worker pool sharing datasets via `SharedArrayBuffer`.
 * - `single-worker`: one browser, Bun, Deno, or Node worker.
 * - `in-process`: no worker; everything runs on the calling thread.
 */
export type OsmixMode = "multi-worker" | "single-worker" | "in-process";

/** Worker implementation available in the current runtime. */
export type WorkerRuntime = "web" | "bun" | "deno" | "node" | "none";

/** Options for selecting a bounded worker count while reserving caller capacity. */
export interface SelectWorkerCountOptions {
  /** Available logical processors. Defaults to the current runtime capability. */
  hardwareConcurrency?: number;
  /** Logical processors to leave for the caller. Defaults to 0. */
  reserveCores?: number;
  /** Upper bound for the selected worker count. Defaults to no explicit bound. */
  maxWorkers?: number;
}

/** Snapshot of the runtime capabilities that determine which `OsmixMode`s are available. */
export interface OsmixCapabilities {
  /** The Web Worker API is available. Always false in Node. */
  webWorkers: boolean;
  /** Worker runtime selected by Osmix (`worker_threads` in Node, Web Workers elsewhere). */
  workerRuntime: WorkerRuntime;
  /** The `SharedArrayBuffer` constructor exists. */
  sharedArrayBuffer: boolean;
  /** `globalThis.crossOriginIsolated === true` (browser COOP/COEP signal). */
  crossOriginIsolated: boolean;
  /** `SharedArrayBuffer`s can actually be posted between threads. */
  canShareArrayBuffers: boolean;
  /** Transferable `ReadableStream`s are supported. */
  streamTransfer: boolean;
  /** Reported CPU concurrency, defaulting to 1 when unavailable. */
  hardwareConcurrency: number;
  /** Number of workers `createRemote()` will use by default. */
  maxWorkers: number;
  /** The mode `createRemote()` will select by default in this runtime. */
  recommendedMode: OsmixMode;
}

/** Detect the worker implementation available to Osmix. */
export function getWorkerRuntime(): WorkerRuntime {
  const bun = Reflect.get(globalThis, "Bun") as { version?: unknown } | undefined;
  if (typeof bun?.version === "string") return "bun";

  const deno = Reflect.get(globalThis, "Deno") as { version?: { deno?: unknown } } | undefined;
  if (typeof deno?.version?.deno === "string") return "deno";

  if (
    typeof process !== "undefined" &&
    process.release?.name === "node" &&
    typeof process.versions?.node === "string"
  ) {
    return "node";
  }
  return typeof Worker !== "undefined" ? "web" : "none";
}

/**
 * Select a worker count while reserving logical processors for the calling thread.
 * Always returns at least one worker.
 */
export function selectWorkerCount({
  hardwareConcurrency = getOsmixCapabilities().hardwareConcurrency,
  reserveCores = 0,
  maxWorkers = Number.POSITIVE_INFINITY,
}: SelectWorkerCountOptions = {}): number {
  const hardware = Number.isFinite(hardwareConcurrency)
    ? Math.max(1, Math.floor(hardwareConcurrency))
    : 1;
  const reserve = Number.isFinite(reserveCores) ? Math.max(0, Math.floor(reserveCores)) : 0;
  const maximum = Number.isFinite(maxWorkers)
    ? Math.max(1, Math.floor(maxWorkers))
    : Number.POSITIVE_INFINITY;
  return Math.max(1, Math.min(maximum, hardware - reserve));
}

/**
 * Check whether `SharedArrayBuffer`s can be shared across threads.
 *
 * Browsers only allow posting `SharedArrayBuffer`s between threads in
 * cross-origin isolated contexts (COOP/COEP headers). Node and other
 * runtimes that expose the constructor can always share.
 */
export function canShareArrayBuffers(): boolean {
  if (typeof SharedArrayBuffer === "undefined") return false;
  if (getWorkerRuntime() === "node") return true;
  // Browsers gate postMessage of SharedArrayBuffers behind cross-origin isolation.
  if ("crossOriginIsolated" in globalThis) return globalThis.crossOriginIsolated === true;
  return true;
}

/**
 * Detect the current runtime's Osmix-relevant capabilities.
 * Evaluated fresh on each call; cache the result if calling in a hot path.
 */
export function getOsmixCapabilities(): OsmixCapabilities {
  const webWorkers = typeof Worker !== "undefined";
  const workerRuntime = getWorkerRuntime();
  const sharedArrayBuffer = typeof SharedArrayBuffer !== "undefined";
  const crossOriginIsolated = globalThis.crossOriginIsolated === true;
  const canShare = canShareArrayBuffers();
  const hardwareConcurrency = globalThis.navigator?.hardwareConcurrency ?? 1;
  const maxWorkers = workerRuntime !== "none" && canShare ? hardwareConcurrency : 1;
  return {
    webWorkers,
    workerRuntime,
    sharedArrayBuffer,
    crossOriginIsolated,
    canShareArrayBuffers: canShare,
    streamTransfer: supportsReadableStreamTransfer(),
    hardwareConcurrency,
    maxWorkers,
    recommendedMode:
      workerRuntime !== "none" ? (maxWorkers > 1 ? "multi-worker" : "single-worker") : "in-process",
  };
}
