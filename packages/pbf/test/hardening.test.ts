import { describe, expect, it } from "vitest";

import { readOsmHeaderBlock } from "../src/blobs-to-blocks";
import { OsmPbfBytesToBlocksTransformStream } from "../src/pbf-to-blocks";
import { MAX_BLOB_SIZE_BYTES } from "../src/spec";
import { webCompress } from "../src/utils";
import { createSamplePbfFileBytes } from "./helpers";

describe("PBF framing hardening", () => {
  it("rejects a declared raw-size mismatch", async () => {
    const compressed = await webCompress(Uint8Array.of(1) as Uint8Array<ArrayBuffer>);

    await expect(
      readOsmHeaderBlock(
        { data: compressed, rawSize: 2 },
        async () => Uint8Array.of(1) as Uint8Array<ArrayBuffer>,
      ),
    ).rejects.toThrow(/does not match declared raw size/);
  });

  it("rejects a decompressor result above the maximum", async () => {
    const compressed = Uint8Array.of(1) as Uint8Array<ArrayBuffer>;
    const oversized = new Uint8Array(MAX_BLOB_SIZE_BYTES + 1) as Uint8Array<ArrayBuffer>;

    await expect(readOsmHeaderBlock(compressed, async () => oversized)).rejects.toThrow(
      /Decompressed blob exceeds/,
    );
  });

  it("rejects truncation in prefixes, headers, and blobs", async () => {
    const { fileBytes } = await createSamplePbfFileBytes();
    for (const cut of [1, 2, 3, 4, 5, fileBytes.length - 1]) {
      const input = new ReadableStream({
        start(controller) {
          controller.enqueue(fileBytes.slice(0, cut));
          controller.close();
        },
      });
      await expect(
        input.pipeThrough(new OsmPbfBytesToBlocksTransformStream()).pipeTo(new WritableStream()),
      ).rejects.toThrow(/truncated/);
    }
  });
});
