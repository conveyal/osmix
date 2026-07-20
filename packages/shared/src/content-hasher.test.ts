import { describe, expect, it } from "vitest";

import { hashBuffers } from "./content-hasher.ts";

describe("ContentHasher", () => {
  it("hashes only the bytes covered by a typed-array view", () => {
    const containingBuffer = new Uint8Array([99, 1, 2, 3, 100]);

    expect(hashBuffers(containingBuffer.subarray(1, 4))).toBe(
      hashBuffers(new Uint8Array([1, 2, 3])),
    );
    expect(hashBuffers(containingBuffer.subarray(1, 4))).not.toBe(hashBuffers(containingBuffer));
  });
});
