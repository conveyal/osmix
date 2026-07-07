/**
 * Utility functions for worker communication and data streaming.
 *
 * Provides helpers for collecting transferable buffers and feature detection.
 *
 * @module
 */

import { transfer as comlinkTransfer } from "comlink";

/** Types that can be transferred between workers without copying. */
export type Transferables = ArrayBufferLike | ReadableStream;

/**
 * Recursively collect all transferable values from a nested object.
 * Searches for ArrayBuffers, TypedArray buffers, and ReadableStreams.
 * Used to prepare data for zero-copy transfer to or from workers.
 */
export function collectTransferables(value: unknown): Transferables[] {
  const transferables: Transferables[] = [];

  if (value instanceof ArrayBuffer) transferables.push(value);
  else if (value instanceof ReadableStream) transferables.push(value);
  else if (ArrayBuffer.isView(value)) transferables.push(value.buffer);
  else if (Array.isArray(value)) {
    for (const item of value) {
      transferables.push(...collectTransferables(item));
    }
  } else if (value && typeof value === "object") {
    for (const item of Object.values(value)) {
      transferables.push(...collectTransferables(item));
    }
  }

  return transferables;
}

/**
 * Wrap data with Comlink.transfer, automatically collecting transferable buffers.
 * Enables zero-copy message passing for typed arrays and streams.
 */
export function transfer<T>(data: T) {
  return comlinkTransfer(data, collectTransferables(data));
}

/**
 * Feature-detect whether the browser supports transferable ReadableStreams.
 * Attempts to post a stream through a MessageChannel; throws DataCloneError if unsupported.
 */
export function supportsReadableStreamTransfer(): boolean {
  // Require the basics first
  if (typeof ReadableStream === "undefined" || typeof MessageChannel === "undefined") return false;

  const { port1 } = new MessageChannel();
  try {
    const rs = new ReadableStream(); // empty is fine for feature test
    // If transferable streams are unsupported, this line throws a DataCloneError
    port1.postMessage(rs, [rs]);
    return true;
  } catch {
    return false;
  } finally {
    port1.close();
  }
}
