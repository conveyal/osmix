import { describe, expect, it } from "vitest";

import type { VtPbfLayer, VtSimpleFeature } from "./types.ts";
import writeVtPbf from "./write-vt-pbf.ts";

function* points(name: string, count: number): Generator<VtSimpleFeature> {
  for (let i = 0; i < count; i++) {
    yield { id: i + 1, type: 1, properties: { name: `${name}-${i}` }, geometry: [[[i, i]]] };
  }
}

function layer(name: string, count: number): VtPbfLayer {
  return { name, version: 2, extent: 4096, features: points(name, count) };
}

describe("writeVtPbf", () => {
  it("returns only the encoded bytes", () => {
    // MVT layers are independent messages, so a two-layer tile is the two one-layer tiles
    // concatenated. Spare writer capacity in either result would break the equality.
    const both = new Uint8Array(writeVtPbf([layer("a", 3), layer("b", 5)]));
    const a = new Uint8Array(writeVtPbf([layer("a", 3)]));
    const b = new Uint8Array(writeVtPbf([layer("b", 5)]));

    expect(both.byteLength).toBe(a.byteLength + b.byteLength);
    expect(both).toEqual(new Uint8Array([...a, ...b]));
  });
});
