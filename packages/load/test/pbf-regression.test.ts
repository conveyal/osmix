import { osmBlockToPbfBlobBytes, concatUint8 } from "@osmix/pbf";
import { createSampleHeader, createSamplePrimitiveBlock } from "@osmix/pbf/test/helpers";
import { describe, expect, it } from "vitest";

import { fromPbf } from "../src/pbf";

describe("PBF loading regressions", () => {
  it("rejects a truncated frame instead of returning the valid prefix", async () => {
    const header = await osmBlockToPbfBlobBytes(createSampleHeader());
    const primitive = await osmBlockToPbfBlobBytes(createSamplePrimitiveBlock());
    const truncated = concatUint8(header, primitive.slice(0, -1));

    await expect(fromPbf(truncated, {}, () => {})).rejects.toThrow(/truncated/);
  });
});
