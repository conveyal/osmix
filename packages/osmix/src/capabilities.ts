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
 * - `multi-worker`: a pool of Web Workers sharing datasets via `SharedArrayBuffer`.
 * - `single-worker`: one Web Worker; data is transferred/cloned instead of shared.
 * - `in-process`: no Web Worker; everything runs on the calling thread.
 */
export type OsmixMode = "multi-worker" | "single-worker" | "in-process";

/** Snapshot of the runtime capabilities that determine which `OsmixMode`s are available. */
export interface OsmixCapabilities {
  /** Web Workers are available (`typeof Worker !== "undefined"`). Always false in Node. */
  webWorkers: boolean;
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

/**
 * Check whether `SharedArrayBuffer`s can be shared across threads.
 *
 * Browsers only allow posting `SharedArrayBuffer`s between threads in
 * cross-origin isolated contexts (COOP/COEP headers). Node and other
 * runtimes that expose the constructor can always share.
 */
export function canShareArrayBuffers(): boolean {
  if (typeof SharedArrayBuffer === "undefined") return false;
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
  const sharedArrayBuffer = typeof SharedArrayBuffer !== "undefined";
  const crossOriginIsolated = globalThis.crossOriginIsolated === true;
  const canShare = canShareArrayBuffers();
  const hardwareConcurrency = globalThis.navigator?.hardwareConcurrency ?? 1;
  const maxWorkers = webWorkers && canShare ? hardwareConcurrency : 1;
  return {
    webWorkers,
    sharedArrayBuffer,
    crossOriginIsolated,
    canShareArrayBuffers: canShare,
    streamTransfer: supportsReadableStreamTransfer(),
    hardwareConcurrency,
    maxWorkers,
    recommendedMode: webWorkers
      ? maxWorkers > 1
        ? "multi-worker"
        : "single-worker"
      : "in-process",
  };
}
