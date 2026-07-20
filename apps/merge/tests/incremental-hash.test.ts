import { describe, expect, it, vi } from "vitest";

import { hashFileIncrementally, hashStreamIncrementally } from "../src/workers/incremental-hash";

describe("incremental hashing", () => {
  it("hashes File.stream() without invoking File.arrayBuffer()", async () => {
    const arrayBuffer = vi.fn(() => {
      throw new Error("arrayBuffer() must not be called");
    });
    const stream = vi.fn(() => new Blob([new TextEncoder().encode("abc")]).stream());
    const file = { arrayBuffer, stream };

    await expect(hashFileIncrementally(file)).resolves.toBe(
      "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad",
    );
    expect(stream).toHaveBeenCalledOnce();
    expect(arrayBuffer).not.toHaveBeenCalled();
  });

  it("cancels the reader and stops consuming chunks", async () => {
    let chunksProduced = 0;
    let cancelled = false;
    let interval: ReturnType<typeof setInterval> | undefined;
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        interval = setInterval(() => {
          chunksProduced++;
          controller.enqueue(new Uint8Array([chunksProduced & 0xff]));
        }, 1);
      },
      cancel() {
        cancelled = true;
        if (interval) clearInterval(interval);
      },
    });
    const controller = new AbortController();
    const hashing = hashStreamIncrementally(stream, { signal: controller.signal });
    while (chunksProduced < 3) await new Promise((resolve) => setTimeout(resolve, 1));

    controller.abort();
    await expect(hashing).rejects.toMatchObject({ name: "AbortError" });
    expect(cancelled).toBe(true);
    const producedAtCancellation = chunksProduced;
    await new Promise((resolve) => setTimeout(resolve, 5));
    expect(chunksProduced).toBe(producedAtCancellation);
  });
});
