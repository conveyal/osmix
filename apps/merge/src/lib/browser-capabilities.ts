import * as Comlink from "comlink";
import type { OsmLoadCapabilities } from "osmix";

import type { BrowserCheckWorkerApi, BufferKind } from "../workers/browser-check.worker";

export interface BrowserLoadCapabilities extends OsmLoadCapabilities {
  arrayBufferMaxBytes: number;
  sharedArrayBufferMaxBytes?: number;
}

let capabilitiesPromise: Promise<BrowserLoadCapabilities> | null = null;
const PROBE_TIMEOUT_MS = 30_000;

/** Run one isolated buffer probe and dispose its worker afterward. */
async function runBufferCeilingProbe(kind: BufferKind): Promise<number | null> {
  const worker = new Worker(new URL("../workers/browser-check.worker.ts", import.meta.url), {
    type: "module",
  });
  const remote = Comlink.wrap<BrowserCheckWorkerApi>(worker);
  let timeout: ReturnType<typeof setTimeout> | undefined;
  try {
    const workerFailure = new Promise<never>((_, reject) => {
      worker.addEventListener(
        "error",
        (event) => reject(new Error(event.message || `${kind} probe worker failed`)),
        { once: true },
      );
      worker.addEventListener(
        "messageerror",
        () => reject(new Error(`${kind} probe worker returned an unreadable result`)),
        { once: true },
      );
    });
    const timedOut = new Promise<never>((_, reject) => {
      timeout = setTimeout(
        () => reject(new Error(`${kind} probe exceeded ${PROBE_TIMEOUT_MS / 1000} seconds`)),
        PROBE_TIMEOUT_MS,
      );
    });
    return await Promise.race([remote.probeBufferCeiling(kind), workerFailure, timedOut]);
  } finally {
    if (timeout !== undefined) clearTimeout(timeout);
    remote[Comlink.releaseProxy]();
    worker.terminate();
  }
}

function reportedDeviceMemoryBytes(): number | undefined {
  const gib = (navigator as Navigator & { deviceMemory?: number }).deviceMemory;
  return typeof gib === "number" && Number.isFinite(gib) && gib > 0 ? gib * 2 ** 30 : undefined;
}

/**
 * Probe buffer ceilings once for this page. Each kind uses a disposable worker;
 * subsequent loads and Check System reuse the cached plain-data result.
 */
export function getBrowserLoadCapabilities(): Promise<BrowserLoadCapabilities> {
  if (capabilitiesPromise) return capabilitiesPromise;
  const pending: Promise<BrowserLoadCapabilities> = (async () => {
    const arrayBufferMaxBytes = await runBufferCeilingProbe("array-buffer");
    if (arrayBufferMaxBytes === null) throw new Error("ArrayBuffer is unavailable");
    const sharedArrayBufferMaxBytes = await runBufferCeilingProbe("shared-array-buffer");
    const activeBufferType =
      globalThis.crossOriginIsolated && sharedArrayBufferMaxBytes !== null
        ? "shared-array-buffer"
        : "array-buffer";
    return {
      activeBufferType,
      arrayBufferMaxBytes,
      ...(sharedArrayBufferMaxBytes === null ? {} : { sharedArrayBufferMaxBytes }),
      ...(reportedDeviceMemoryBytes() === undefined
        ? {}
        : { deviceMemoryBytes: reportedDeviceMemoryBytes() }),
    };
  })();
  capabilitiesPromise = pending;
  void pending.catch(() => {
    if (capabilitiesPromise === pending) capabilitiesPromise = null;
  });
  return pending;
}
