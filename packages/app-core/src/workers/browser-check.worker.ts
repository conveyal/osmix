import * as Comlink from "comlink";

export type BufferKind = "array-buffer" | "shared-array-buffer";

const MIB = 2 ** 20;
const INITIAL_PROBE_BYTES = 16 * MIB;
const MAX_PROBE_BYTES = 4 * 2 ** 30 - MIB;

function canAllocate(kind: BufferKind, byteLength: number): boolean {
  try {
    const buffer =
      kind === "shared-array-buffer"
        ? new SharedArrayBuffer(byteLength)
        : new ArrayBuffer(byteLength);
    if (byteLength > 0) {
      const bytes = new Uint8Array(buffer);
      bytes[0] = 1;
      bytes[byteLength - 1] = 1;
    }
    return true;
  } catch {
    return false;
  }
}

/**
 * Find the largest buffer allocation that succeeds, rounded down to 1 MiB.
 * The worker is terminated after each buffer-kind probe so failed allocations
 * and virtual address reservations cannot affect the other result.
 */
function probeBufferCeiling(kind: BufferKind): number | null {
  if (kind === "shared-array-buffer" && typeof SharedArrayBuffer === "undefined") return null;

  let lower = 0;
  let upper = INITIAL_PROBE_BYTES;
  while (upper < MAX_PROBE_BYTES && canAllocate(kind, upper)) {
    lower = upper;
    upper = Math.min(upper * 2, MAX_PROBE_BYTES);
  }
  if (upper === MAX_PROBE_BYTES && canAllocate(kind, upper)) return upper;

  while (upper - lower > MIB) {
    const midpoint = Math.floor((lower + upper) / (2 * MIB)) * MIB;
    if (midpoint <= lower) break;
    if (canAllocate(kind, midpoint)) lower = midpoint;
    else upper = midpoint;
  }
  return lower;
}

const BrowserCheckWorker = { probeBufferCeiling };

if ("importScripts" in globalThis) Comlink.expose(BrowserCheckWorker);

export type BrowserCheckWorkerApi = typeof BrowserCheckWorker;
