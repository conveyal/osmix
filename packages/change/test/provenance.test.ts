import { Osm } from "@osmix/core";
import { describe, expect, it } from "vitest";

import { inputProvenance } from "../src/provenance.ts";

describe("inputProvenance", () => {
  it("tells base, imported and same-ID entities apart", () => {
    const base = new Osm({ id: "base" });
    base.nodes.addNode({ id: 1, lon: 0, lat: 0 });
    base.nodes.addNode({ id: 2, lon: 0, lat: 0 });
    base.buildIndexes();
    const patch = new Osm({ id: "patch" });
    patch.nodes.addNode({ id: 2, lon: 0, lat: 0 });
    patch.nodes.addNode({ id: -1, lon: 0, lat: 0 });
    patch.buildIndexes();
    const provenance = inputProvenance(base, patch);
    expect(provenance.isBase("node", 1)).toBe(true);
    expect(provenance.isImported("node", 1)).toBe(false);
    expect(provenance.isSameId("node", 2)).toBe(true);
    expect(provenance.isImported("node", 2)).toBe(false);
    expect(provenance.isImported("node", -1)).toBe(true);
    expect(provenance.isPatch("way", -1)).toBe(false);
  });
});
