import { PbfWriter } from "pbf";
import { describe, expect, it } from "vitest";

import { osmPbfBlobsToBlocksGenerator } from "../src/blobs-to-blocks";
import { createOsmPbfBlobFrameGenerator, createOsmPbfBlobGenerator } from "../src/pbf-to-blobs";
import { writeBlob, writeBlobHeader } from "../src/proto/fileformat";
import { writeHeaderBlock } from "../src/proto/osmformat";
import { MAX_BLOB_SIZE_BYTES, MAX_HEADER_SIZE_BYTES } from "../src/spec";
import { concatUint8, uint32BE } from "../src/utils";
import {
  createSampleHeader,
  createSamplePbfFileBytes,
  isHeaderBlock,
  isPrimitiveBlock,
} from "./helpers";

describe("createOsmPbfBlobGenerator", () => {
  it("yields compressed blobs across fragmented chunks", async () => {
    const { header, primitiveBlock, fileBytes } = await createSamplePbfFileBytes();
    const generate = createOsmPbfBlobGenerator();
    const yielded: Uint8Array<ArrayBuffer>[] = [];

    let offset = 0;
    const chunkSizes = [1, 9];
    for (const size of chunkSizes) {
      const chunk = fileBytes.slice(offset, offset + size);
      offset += size;
      for (const blob of generate(chunk)) yielded.push(blob);
    }
    if (offset < fileBytes.length) {
      for (const blob of generate(fileBytes.slice(offset))) yielded.push(blob);
    }

    expect(yielded.length).toBe(2);

    const blocks = osmPbfBlobsToBlocksGenerator(
      (async function* () {
        for (const blob of yielded) yield blob;
      })(),
    );
    const { value: headerBlock, done } = await blocks.next();
    expect(done).toBe(false);
    if (!isHeaderBlock(headerBlock)) {
      throw new Error("Expected first block to be a header");
    }
    expect(headerBlock.bbox).toEqual(header.bbox);
    expect(headerBlock.required_features).toEqual(header.required_features);
    expect(headerBlock.optional_features).toEqual(header.optional_features);

    const { value: primitive } = await blocks.next();
    if (!isPrimitiveBlock(primitive)) {
      throw new Error("Expected primitive block after header");
    }
    expect(primitive.primitivegroup).toHaveLength(primitiveBlock.primitivegroup.length);
    expect(primitive.primitivegroup[0]).toBeDefined();
    expect(primitiveBlock.primitivegroup[0]).toBeDefined();
    if (!primitive.primitivegroup[0]) throw new Error("primitive.primitivegroup[0] is undefined");
    if (!primitiveBlock.primitivegroup[0])
      throw new Error("primitiveBlock.primitivegroup[0] is undefined");
    const dense = primitive.primitivegroup[0].dense;
    expect(dense).toBeDefined();
    if (!dense) throw new Error("dense is undefined");
    if (!primitiveBlock.primitivegroup[0]?.dense)
      throw new Error("primitiveBlock.primitivegroup[0].dense is undefined");
    expect(dense.id).toEqual(primitiveBlock.primitivegroup[0].dense.id);
    expect(dense.lat).toEqual(primitiveBlock.primitivegroup[0].dense.lat);
    expect(dense.lon).toEqual(primitiveBlock.primitivegroup[0].dense.lon);
  });

  it("throws when a blob omits zlib data", () => {
    const headerBlock = createSampleHeader();
    const headerPbf = new PbfWriter();
    writeHeaderBlock(headerBlock, headerPbf);
    const headerContent = headerPbf.finish();

    const blobPbf = new PbfWriter();
    writeBlob({ raw_size: headerContent.length, raw: headerContent }, blobPbf);
    const blob = blobPbf.finish();

    const blobHeaderPbf = new PbfWriter();
    writeBlobHeader({ type: "OSMHeader", datasize: blob.length }, blobHeaderPbf);
    const blobHeader = blobHeaderPbf.finish();

    const chunk = concatUint8(uint32BE(blobHeader.byteLength), blobHeader, blob);
    const generate = createOsmPbfBlobGenerator();
    const iterator = generate(chunk);
    expect(() => iterator.next()).toThrow(/Blob has no zlib data/);
  });

  it.each([
    ["zero", 0],
    ["high-bit", 0x8000_0000],
    ["over-limit", MAX_HEADER_SIZE_BYTES + 1],
  ])("rejects %s header lengths", (_name, length) => {
    const generate = createOsmPbfBlobGenerator();
    expect(() => generate(uint32BE(length).buffer).next()).toThrow(/Invalid PBF frame/);
  });

  it.each([
    ["zero", 0],
    ["over-limit", MAX_BLOB_SIZE_BYTES + 1],
  ])("rejects %s blob sizes", (_name, size) => {
    const blobHeaderPbf = new PbfWriter();
    writeBlobHeader({ type: "OSMHeader", datasize: size }, blobHeaderPbf);
    const blobHeader = blobHeaderPbf.finish();
    const generate = createOsmPbfBlobGenerator();

    expect(() => generate(concatUint8(uint32BE(blobHeader.length), blobHeader)).next()).toThrow(
      /Invalid PBF frame/,
    );
  });

  it("rejects raw sizes over the decompression limit", () => {
    const blobPbf = new PbfWriter();
    writeBlob({ raw_size: MAX_BLOB_SIZE_BYTES + 1, zlib_data: Uint8Array.of(1) }, blobPbf);
    const blob = blobPbf.finish();
    const blobHeaderPbf = new PbfWriter();
    writeBlobHeader({ type: "OSMData", datasize: blob.length }, blobHeaderPbf);
    const blobHeader = blobHeaderPbf.finish();
    const generate = createOsmPbfBlobGenerator();

    expect(() =>
      generate(concatUint8(uint32BE(blobHeader.length), blobHeader, blob)).next(),
    ).toThrow(/raw size exceeds/);
  });

  it("rejects zero raw sizes", () => {
    const blobPbf = new PbfWriter();
    writeBlob({ raw_size: 0, zlib_data: Uint8Array.of(1) }, blobPbf);
    const blob = blobPbf.finish();
    const blobHeaderPbf = new PbfWriter();
    writeBlobHeader({ type: "OSMData", datasize: blob.length }, blobHeaderPbf);
    const blobHeader = blobHeaderPbf.finish();
    const generate = createOsmPbfBlobGenerator();

    expect(() =>
      generate(concatUint8(uint32BE(blobHeader.length), blobHeader, blob)).next(),
    ).toThrow(/raw size is zero/);
  });

  it("rejects incomplete framing at finish", async () => {
    const { fileBytes } = await createSamplePbfFileBytes();
    for (const cut of [1, 2, 3, 4, 5]) {
      const parser = createOsmPbfBlobFrameGenerator();
      const frames = [...parser.nextChunk(fileBytes.slice(0, cut))];
      expect(frames).toBeDefined();
      expect(() => parser.finish()).toThrow(/truncated/);
    }
    for (const end of [1, 2, 3]) {
      const parser = createOsmPbfBlobFrameGenerator();
      const frames = [...parser.nextChunk(fileBytes.slice(0, fileBytes.length - end))];
      expect(frames).toBeDefined();
      expect(() => parser.finish()).toThrow(/truncated/);
    }
  });
});
