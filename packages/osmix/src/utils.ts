/**
 * Utility functions for worker communication and data streaming.
 *
 * Provides helpers for collecting transferable buffers and feature detection.
 *
 * @module
 */

import { isSharedArrayBuffer } from "@osmix/shared/backing-buffers";
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
  const seenTransferables = new Set<Transferables>();
  const visited = new Set<object>();

  const addTransferable = (transferable: Transferables) => {
    if (isSharedArrayBuffer(transferable) || seenTransferables.has(transferable)) return;
    seenTransferables.add(transferable);
    transferables.push(transferable);
  };

  const visit = (current: unknown): void => {
    if (current instanceof ArrayBuffer) {
      addTransferable(current);
      return;
    }
    if (isSharedArrayBuffer(current)) return;
    if (current instanceof ReadableStream) {
      addTransferable(current);
      return;
    }
    if (ArrayBuffer.isView(current)) {
      if (current.buffer instanceof ArrayBuffer) addTransferable(current.buffer);
      return;
    }
    if (!current || typeof current !== "object" || visited.has(current)) return;
    visited.add(current);

    if (Array.isArray(current)) {
      for (const item of current) visit(item);
      return;
    }
    for (const item of Object.values(current)) visit(item);
  };

  visit(value);

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

  const { port1, port2 } = new MessageChannel();
  try {
    // A closed stream exercises transferability without leaving a live stream resource in Deno.
    const rs = new ReadableStream({ start: (controller) => controller.close() });
    // If transferable streams are unsupported, this line throws a DataCloneError
    port1.postMessage(rs, [rs]);
    return true;
  } catch {
    return false;
  } finally {
    port1.close();
    port2.close();
  }
}
