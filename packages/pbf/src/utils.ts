import type { OsmPbfGroup } from "./proto/osmformat.ts";

export type AsyncGeneratorValue<T> =
  | T
  | ReadableStream<T>
  | AsyncGenerator<T>
  | Promise<T>
  | Promise<ReadableStream<T>>
  | Promise<AsyncGenerator<T>>;

/**
 * Normalizes values, streams, and iterables into a unified async generator interface.
 */
export async function* toAsyncGenerator<T>(v: AsyncGeneratorValue<T>): AsyncGenerator<T> {
  if (v instanceof Promise) return toAsyncGenerator(await v);

  if (v == null) throw Error("Value is null");
  if (v instanceof ReadableStream) {
    const reader = v.getReader();
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      yield value;
    }
    reader.releaseLock();
  } else if (ArrayBuffer.isView(v) || v instanceof ArrayBuffer) {
    // Treat ArrayBuffer and TypedArrays (like Uint8Array, Buffer) as single values
    yield v as T;
  } else if (typeof v === "object" && (Symbol.asyncIterator in v || Symbol.iterator in v)) {
    return v;
  } else {
    yield v;
  }
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
): Promise<Uint8Array<ArrayBuffer>> {
  const reader = stream.getReader();
  const chunks: Uint8Array<ArrayBuffer>[] = [];

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    if (value !== undefined) chunks.push(value);
  }

  const total = chunks.reduce((n, p) => n + p.length, 0);
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
): Promise<Uint8Array<ArrayBuffer>> {
  return streamToBytes(bytesToStream(bytes).pipeThrough(transformStream));
}

/**
 * Web decompression stream
 */
export async function webDecompress(
  data: Uint8Array<ArrayBuffer>,
): Promise<Uint8Array<ArrayBuffer>> {
  return transformBytes(data, new DecompressionStream("deflate"));
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
