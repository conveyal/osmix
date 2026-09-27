import { Osm } from "@osmix/core";
import { describe, expect, it } from "vitest";

import { applyChangesetToOsm } from "../src/apply-changeset.ts";
import { planWithinDatasetDeduplication } from "../src/plan/deduplication.ts";
import { stagedChanges } from "./helpers/changes.ts";

const quiet = () => {};

/** Two ways whose nodes and refs duplicate each other, plus a relation that references both. */
function duplicated(id = "duplicated") {
  const osm = new Osm({ id });
  osm.nodes.addNode({ id: 1, lon: 0, lat: 0 });
  osm.nodes.addNode({ id: 2, lon: 0.001, lat: 0 });
  osm.nodes.addNode({ id: 11, lon: 0, lat: 0 });
  osm.nodes.addNode({ id: 12, lon: 0.001, lat: 0 });
  osm.nodes.addNode({ id: 21, lon: 0.002, lat: 0, tags: { barrier: "gate" } });
  osm.nodes.addNode({ id: 22, lon: 0.002, lat: 0 });
  osm.ways.addWay({ id: 10, refs: [1, 2], tags: { highway: "residential" } });
  osm.ways.addWay({ id: 20, refs: [11, 12], tags: { highway: "residential" } });
  osm.ways.addWay({ id: 30, refs: [12, 21], tags: { highway: "residential" } });
  osm.ways.addWay({ id: 40, refs: [22, 2], tags: { highway: "footway" } });
  osm.relations.addRelation({
    id: 100,
    tags: { type: "route" },
    members: [
      { type: "way", ref: 10, role: "" },
      { type: "way", ref: 20, role: "" },
      { type: "node", ref: 1, role: "stop" },
    ],
  });
  osm.buildIndexes();
  osm.buildSpatialIndexes();
  return osm;
}

describe("planWithinDatasetDeduplication", () => {
  it("keeps the highest compatible ID and moves refs and members to it", () => {
    const osm = duplicated();
    const changes = planWithinDatasetDeduplication(osm, quiet);
    expect(changes.stats).toMatchObject({ deduplicatedNodes: 2, deduplicatedWays: 1 });
    const cleaned = applyChangesetToOsm(changes);
    expect(cleaned.nodes.getById(1)).toBeNull();
    expect(cleaned.ways.getById(10)).toBeNull();
    expect(cleaned.ways.getById(20)?.refs).toEqual([11, 12]);
    expect(cleaned.relations.getById(100)?.members).toEqual([
      { type: "way", ref: 20, role: "" },
      { type: "node", ref: 11, role: "stop" },
    ]);
    // A gate at the same spot as an untagged vertex would add a barrier to its ways.
    expect(cleaned.nodes.getById(21)).toBeTruthy();
    expect(cleaned.nodes.getById(22)).toBeTruthy();
    expect(planWithinDatasetDeduplication(cleaned, quiet).stats.totalChanges).toBe(0);
  });

  it("finds what the staged same-dataset scan found", () => {
    const osm = duplicated();
    const staged = stagedChanges(osm, osm, { deduplicateNodes: true, deduplicateWays: true });
    const planned = planWithinDatasetDeduplication(osm, quiet);
    expect(applyChangesetToOsm(planned).contentHash()).toBe(
      applyChangesetToOsm(staged).contentHash(),
    );
  });
});
