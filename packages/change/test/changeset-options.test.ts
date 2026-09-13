import { Osm } from "@osmix/core";
import { describe, expect, expectTypeOf, it, vi } from "vitest";

import {
  applyChangesetToOsm,
  generateChangeset,
  generateConflationChangeset,
  merge,
  type OsmChangesetOptions,
} from "../src/index.ts";

const conflation = { propertyKeys: ["name"], attachNetwork: false };
const error =
  "generateChangeset does not support conflation; use generateConflationChangeset() or merge() instead";

function inputs() {
  const base = new Osm({ id: "base" });
  base.nodes.addNode({ id: 1, lon: 0, lat: 0, tags: { amenity: "cafe", name: "Base" } });
  base.buildIndexes();
  base.buildSpatialIndexes();
  const patch = new Osm({ id: "patch" });
  patch.nodes.addNode({
    id: 101,
    lon: 0.000005,
    lat: 0,
    tags: { amenity: "cafe", name: "Imported" },
  });
  patch.buildIndexes();
  patch.buildSpatialIndexes();
  return { base, patch };
}

describe("ordinary changeset option boundary", () => {
  it.each([conflation, null, false, 0])(
    "rejects a defined configuration (%j) before generation",
    (value) => {
      const { base, patch } = inputs();
      const before = [[...base.nodes], [...patch.nodes]];
      const progress = vi.fn();
      // A structurally wider object is valid TypeScript after narrowing the API.
      const options = { directMerge: true, conflation: value };
      expect(() => generateChangeset(base, patch, options, progress)).toThrow(error);
      expect(progress).not.toHaveBeenCalled();
      expect([[...base.nodes], [...patch.nodes]]).toEqual(before);
    },
  );

  it("rejects an inherited configuration instead of overlooking it", () => {
    const { base, patch } = inputs();
    const options = { directMerge: true };
    Object.setPrototypeOf(options, { conflation });
    expect(() => generateChangeset(base, patch, options)).toThrow(error);
  });

  it("keeps ordinary generation and undefined configuration compatible", () => {
    const { base, patch } = inputs();
    const options = { directMerge: true, conflation: undefined };
    const result = applyChangesetToOsm(generateChangeset(base, patch, options));
    expect(result.nodes.getById(1)?.tags?.["name"]).toBe("Base");
    expect(result.nodes.getById(101)).toEqual(patch.nodes.getById(101));
    expect(generateChangeset(base, patch).stats.totalChanges).toBe(0);
  });

  it("keeps matching explicit in supported generation and high-level merge", async () => {
    const { base, patch } = inputs();
    const options = { directMerge: true, conflation };
    const generated = applyChangesetToOsm(generateConflationChangeset(base, patch, options));
    const merged = await merge(base, patch, options);
    for (const result of [generated, merged]) {
      expect(result.nodes.getById(1)?.tags?.["name"]).toBe("Imported");
      expect(result.nodes.getById(101)).toEqual(patch.nodes.getById(101));
    }
  });

  it("advertises ordinary stages without advertising conflation", () => {
    expectTypeOf<OsmChangesetOptions>().not.toHaveProperty("conflation");
    expectTypeOf<NonNullable<Parameters<typeof generateChangeset>[2]>>().toEqualTypeOf<
      Partial<OsmChangesetOptions>
    >();
    expectTypeOf<NonNullable<Parameters<typeof generateConflationChangeset>[2]>>().toHaveProperty(
      "conflation",
    );
  });
});
