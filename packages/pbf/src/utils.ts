import type { OsmPbfGroup } from "./proto/osmformat.ts";
import { MAX_BLOB_SIZE_BYTES } from "./spec.ts";

type AsyncGeneratorSource<T> = T | ReadableStream<T> | Iterable<T> | AsyncIterable<T>;

export type AsyncGeneratorValue<T> = AsyncGeneratorSource<T> | Promise<AsyncGeneratorSource<T>>;

/**
 * Normalize supported values, streams, and iterables into one async generator.
 */
export async function* toAsyncGenerator<T>(input: AsyncGeneratorValue<T>): AsyncGenerator<T> {
  const value = await input;
  if (value == null) throw Error("Value is null");

  if (value instanceof ReadableStream) {
    const reader = value.getReader();
    let completed = false;
    try {
      while (true) {
        const { done, value: chunk } = await reader.read();
        if (done) {
          completed = true;
          break;
        }
        yield chunk;
      }
    } finally {
      if (!completed) await reader.cancel().catch(() => undefined);
      reader.releaseLock();
    }
    return;
  }

  // Treat ArrayBuffer and typed arrays (like Uint8Array and Buffer) as single values.
  if (ArrayBuffer.isView(value) || value instanceof ArrayBuffer) {
    yield value as T;
    return;
  }

  if (typeof value === "object" && Symbol.asyncIterator in value) {
    for await (const item of value as AsyncIterable<T>) yield item;
    return;
  }

  if (typeof value === "object" && Symbol.iterator in value) {
    for (const item of value as Iterable<T>) yield item;
    return;
  }

  yield value as T;
}

function bytesToStream(bytes: Uint8Array<ArrayBuffer>) {
  return new ReadableStream<Uint8Array<ArrayBuffer>>({
    start(controller) {
      controller.enqueue(bytes);
      controller.close();
    },
  });
}

async function streamToBytes(
  stream: ReadableStream<Uint8Array<ArrayBuffer>>,
  maxBytes = Number.POSITIVE_INFINITY,
): Promise<Uint8Array<ArrayBuffer>> {
  const reader = stream.getReader();
  const chunks: Uint8Array<ArrayBuffer>[] = [];
  let total = 0;

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      if (value === undefined) continue;
      if (value.byteLength > maxBytes - total) {
        await reader.cancel("Decompressed output exceeds the maximum size");
        throw Error(`Decompressed blob exceeds ${maxBytes} bytes`);
      }
      chunks.push(value);
      total += value.byteLength;
    }
  } finally {
    reader.releaseLock();
  }

  const out = new Uint8Array(new ArrayBuffer(total));
  let offset = 0;
  for (const p of chunks) {
    out.set(p, offset);
    offset += p.length;
  }
  return out;
}

async function transformBytes(
  bytes: Uint8Array<ArrayBuffer>,
  transformStream: TransformStream<Uint8Array<ArrayBuffer>, Uint8Array<ArrayBuffer>>,
  maxBytes = Number.POSITIVE_INFINITY,
): Promise<Uint8Array<ArrayBuffer>> {
  return streamToBytes(bytesToStream(bytes).pipeThrough(transformStream), maxBytes);
}

/**
 * Web decompression stream
 */
export async function webDecompress(
  data: Uint8Array<ArrayBuffer>,
  maxBytes = MAX_BLOB_SIZE_BYTES,
): Promise<Uint8Array<ArrayBuffer>> {
  return transformBytes(data, new DecompressionStream("deflate"), maxBytes);
}

/**
 * Web compression stream
 */
export async function webCompress(data: Uint8Array<ArrayBuffer>): Promise<Uint8Array<ArrayBuffer>> {
  return transformBytes(data, new CompressionStream("deflate"));
}

/**
 * Concatenates multiple `Uint8Array` segments into a contiguous array.
 */
export function concatUint8(...parts: Uint8Array[]): Uint8Array {
  const total = parts.reduce((n, p) => n + p.length, 0);
  const out = new Uint8Array(total);
  let offset = 0;
  for (const p of parts) {
    out.set(p, offset);
    offset += p.length;
  }
  return out;
}

/**
 * Encodes a 32-bit big-endian unsigned integer as a four-byte buffer.
 */
export function uint32BE(n: number): Uint8Array {
  const out = new Uint8Array(4);
  out[0] = (n >>> 24) & 0xff;
  out[1] = (n >>> 16) & 0xff;
  out[2] = (n >>> 8) & 0xff;
  out[3] = n & 0xff;
  return out;
}

export function createOsmEntityCounter() {
  const count = {
    nodes: 0,
    ways: 0,
    relations: 0,
    node0: -1,
    way0: -1,
    relation0: -1,
  };

  const onGroup = (group: OsmPbfGroup) => {
    if (count.node0 === -1 && group.dense?.id?.[0] != null) {
      count.node0 = group.dense.id[0];
    }
    if (count.way0 === -1 && group.ways?.[0]?.id != null) {
      count.way0 = group.ways[0].id;
    }
    if (count.relation0 === -1 && group.relations?.[0]?.id != null) {
      count.relation0 = group.relations[0].id;
    }

    count.nodes += group.nodes?.length ?? 0;
    if (group.dense) {
      count.nodes += group.dense.id.length;
    }
    count.ways += group.ways?.length ?? 0;
    count.relations += group.relations?.length ?? 0;
  };

  return {
    onGroup,
    count,
  };
}
