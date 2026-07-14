import { describe, expect, it } from "vitest";

import {
  concatUint8,
  toAsyncGenerator,
  type AsyncGeneratorValue,
  uint32BE,
  webCompress,
  webDecompress,
} from "../src/utils";

async function collect<T>(input: AsyncGeneratorValue<T>) {
  const values: T[] = [];
  for await (const value of toAsyncGenerator(input)) values.push(value);
  return values;
}

describe("utils", () => {
  it("wraps values into an async generator", async () => {
    const generator = toAsyncGenerator(3);
    const first = await generator.next();
    expect(first).toEqual({ value: 3, done: false });
    const done = await generator.next();
    expect(done).toEqual({ value: undefined, done: true });
  });

  it("consumes readable streams", async () => {
    const stream = new ReadableStream<number>({
      start(controller) {
        controller.enqueue(1);
        controller.enqueue(2);
        controller.close();
      },
    });
    const values: number[] = [];
    for await (const value of toAsyncGenerator(stream)) values.push(value);
    expect(values).toEqual([1, 2]);
    expect(() => stream.getReader().releaseLock()).not.toThrow();
  });

  it("normalizes promised streams, sync iterables, and async iterables in order", async () => {
    const stream = new ReadableStream<number>({
      start(controller) {
        controller.enqueue(1);
        controller.enqueue(2);
        controller.close();
      },
    });
    async function* asyncValues() {
      yield 3;
      yield 4;
    }

    await expect(collect(Promise.resolve(stream))).resolves.toEqual([1, 2]);
    await expect(collect(Promise.resolve(7))).resolves.toEqual([7]);
    await expect(collect([3, 4])).resolves.toEqual([3, 4]);
    await expect(collect(Promise.resolve([5, 6]))).resolves.toEqual([5, 6]);
    await expect(collect(asyncValues())).resolves.toEqual([3, 4]);
    await expect(collect(Promise.resolve(asyncValues()))).resolves.toEqual([3, 4]);
  });

  it("keeps raw buffers and typed arrays as single values", async () => {
    const bytes = Uint8Array.of(1, 2);
    const buffer = bytes.buffer;

    await expect(collect(bytes)).resolves.toEqual([bytes]);
    await expect(collect(buffer)).resolves.toEqual([buffer]);
    await expect(collect(Promise.resolve(bytes))).resolves.toEqual([bytes]);
  });

  it("handles empty inputs and propagates rejected or throwing inputs", async () => {
    const emptyAsyncValues: AsyncIterable<number> = {
      [Symbol.asyncIterator]() {
        return {
          next: async (): Promise<IteratorResult<number>> => ({ done: true, value: undefined }),
        };
      },
    };
    const throwingAsyncValues: AsyncIterable<number> = {
      [Symbol.asyncIterator]() {
        return {
          next: async (): Promise<IteratorResult<number>> => {
            throw Error("async iterable failed");
          },
        };
      },
    };
    const throwingSyncValues: Iterable<number> = {
      [Symbol.iterator]() {
        throw Error("sync iterable failed");
      },
    };

    await expect(collect([])).resolves.toEqual([]);
    await expect(collect(emptyAsyncValues)).resolves.toEqual([]);
    await expect(collect(Promise.reject(Error("promise failed")))).rejects.toThrow(
      "promise failed",
    );
    await expect(collect(throwingSyncValues)).rejects.toThrow("sync iterable failed");
    await expect(collect(throwingAsyncValues)).rejects.toThrow("async iterable failed");
  });

  it("cancels a stream on early consumer exit and releases its reader", async () => {
    let cancelCount = 0;
    const stream = new ReadableStream<number>({
      start(controller) {
        controller.enqueue(1);
      },
      cancel() {
        cancelCount++;
      },
    });

    const generator = toAsyncGenerator(stream);
    await expect(generator.next()).resolves.toEqual({ value: 1, done: false });
    await generator.return(undefined);

    expect(cancelCount).toBe(1);
    expect(() => stream.getReader().releaseLock()).not.toThrow();
  });

  it("throws on nullish inputs", async () => {
    const invalidInput = null as unknown as never;
    await expect(toAsyncGenerator(invalidInput).next()).rejects.toThrow("Value is null");
  });

  it("concatenates Uint8Array segments", () => {
    const a = Uint8Array.of(1, 2);
    const b = Uint8Array.of(3);
    expect(concatUint8(a, b)).toEqual(Uint8Array.of(1, 2, 3));
  });

  it("encodes big-endian 32-bit integers", () => {
    expect(uint32BE(0x01020304)).toEqual(Uint8Array.of(1, 2, 3, 4));
  });

  it("compresses and decompresses data", async () => {
    const input = new TextEncoder().encode("osmix") as Uint8Array<ArrayBuffer>;
    const compressed = await webCompress(input);
    expect(compressed).not.toEqual(input);
    const decompressed = await webDecompress(compressed);
    expect(decompressed).toEqual(input);
  });

  it("aborts decompression once the output budget is exceeded", async () => {
    const input = new Uint8Array(1024).fill(65) as Uint8Array<ArrayBuffer>;
    const compressed = await webCompress(input);

    await expect(webDecompress(compressed, 100)).rejects.toThrow(/exceeds 100 bytes/);
  });

  it("allows decompression exactly at the output budget", async () => {
    const input = Uint8Array.of(65) as Uint8Array<ArrayBuffer>;
    const compressed = await webCompress(input);

    await expect(webDecompress(compressed, 1)).resolves.toEqual(input);
  });
});
