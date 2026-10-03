import { Osm } from "@osmix/core";
import { describe, expect, it } from "vitest";

import { assertConflationPreservesBaseTopology } from "../src/integrity.ts";
import { PlanOverlay, snapshotState } from "../src/plan/overlay.ts";

function base() {
  const osm = new Osm({ id: "base" });
  osm.nodes.addNode({ id: 1, lon: 0, lat: 0 });
  osm.nodes.addNode({ id: 2, lon: 0.001, lat: 0 });
  osm.nodes.addNode({ id: 3, lon: 0.002, lat: 0 });
  osm.ways.addWay({ id: 10, refs: [1, 2, 3], tags: { highway: "footway" } });
  osm.relations.addRelation({
    id: 50,
    tags: { type: "route" },
    members: [{ type: "way", ref: 10, role: "" }],
  });
  osm.buildIndexes();
  osm.buildSpatialIndexes();
  return osm;
}

describe("base topology guard (MP-I2)", () => {
  it("allows tag changes and rejects geometry, removal and membership changes", () => {
    const osm = base();
    const after = new PlanOverlay(osm);
    const before = after.stateAt(after.mark());
    after.modify("way", 10, (way) => ({ ...way, tags: { highway: "footway", name: "Main" } }));
    expect(() => assertConflationPreservesBaseTopology(osm, before, after)).not.toThrow();

    after.modify("way", 10, (way) => ({ ...way, refs: [1, 3] }));
    after.modify("node", 2, (node) => ({ ...node, lon: 0.0011 }));
    after.modify("relation", 50, (relation) => ({ ...relation, members: [] }));
    expect(() => assertConflationPreservesBaseTopology(osm, before, after)).toThrow(
      /base node 2 coordinates changed.*base way 10 references changed.*base relation 50 members changed/,
    );
  });

  it("allows only the deletions and relation edits an included replacement names", () => {
    const osm = base();
    // A copied state works as the earlier state too.
    const after = new PlanOverlay(osm);
    const before = snapshotState(after.snapshot(), after);
    after.delete(osm.ways.getById(10)!);
    after.delete(osm.nodes.getById(2)!);
    after.modify("relation", 50, (relation) => ({ ...relation, members: [] }));
    const replaced = { ways: new Set([10]), nodes: new Set([2]), relations: new Set([50]) };
    expect(() => assertConflationPreservesBaseTopology(osm, before, after, replaced)).not.toThrow();
    expect(() =>
      assertConflationPreservesBaseTopology(osm, before, after, { ...replaced, nodes: new Set() }),
    ).toThrow(/base node 2 was removed/);
  });
});
