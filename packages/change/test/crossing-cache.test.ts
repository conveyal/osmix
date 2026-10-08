import { Osm } from "@osmix/core";
import type { OsmNode, OsmWay } from "@osmix/types";
import { describe, expect, it } from "vitest";

import { CrossingCache } from "../src/plan/crossing-cache.ts";
import { PlanOverlay } from "../src/plan/overlay.ts";
import { planMerge, setMergePlanDecisions } from "../src/plan/plan.ts";
import { findProposal } from "./helpers/plan.ts";

/** Degrees per meter at the equator. */
const M = 1 / 111_320;
const footway = { highway: "footway" };

function osm(id: string, nodes: OsmNode[], ways: OsmWay[]) {
  const result = new Osm({ id });
  for (const node of nodes) result.nodes.addNode(node);
  for (const way of ways) result.ways.addWay(way);
  result.buildIndexes();
  result.buildSpatialIndexes();
  return result;
}

const fail = () => {
  throw Error("search should not run");
};

describe("CrossingCache", () => {
  const base = osm(
    "base",
    [
      { id: 1, lon: 0, lat: 0 },
      { id: 2, lon: 0.001, lat: 0 },
    ],
    [{ id: 10, refs: [1, 2], tags: footway }],
  );
  const box = [0, -0.0001, 0.001, 0.0001] as [number, number, number, number];

  it("adds a way that came to intersect a box, and drops one that left", () => {
    const cache = new CrossingCache();
    const first = new PlanOverlay(base);
    cache.begin(first);
    expect(cache.nearWays(10, box, (bbox) => first.wayIdsIntersecting(bbox))).toEqual([10]);

    const second = new PlanOverlay(base);
    second.create({ id: -1, lon: 0.0005, lat: -0.001 }, "patch");
    second.create({ id: -2, lon: 0.0005, lat: 0.001 }, "patch");
    second.create({ id: -20, refs: [-1, -2], tags: footway }, "patch");
    cache.begin(second);
    // The way's own box is unchanged, so the search is not repeated.
    expect(cache.nearWays(10, box, fail)).toEqual([-20, 10]);

    const third = new PlanOverlay(base);
    cache.begin(third);
    expect(cache.nearWays(10, box, fail)).toEqual([10]);
  });

  it("searches again for an entry the previous pass did not refresh", () => {
    const cache = new CrossingCache();
    const overlay = new PlanOverlay(base);
    cache.begin(overlay);
    cache.nearWays(10, box, () => [10]);
    cache.begin(overlay);
    cache.begin(overlay);
    expect(cache.nearWays(10, box, () => [10, 99])).toEqual([10, 99]);
  });

  it("reuses crossing points only while both ways' geometry is unchanged", () => {
    const cache = new CrossingCache();
    cache.begin(new PlanOverlay(base));
    const at = (x: number) => () => [[x, 0]] as [number, number][];
    // Revisions count geometry changes: equal revisions mean the same lines.
    expect(cache.crossingPoints(10, 0, 20, 0, at(0.5))).toEqual([[0.5, 0]]);
    expect(cache.crossingPoints(10, 0, 20, 0, fail)).toEqual([[0.5, 0]]);
    expect(cache.crossingPoints(10, 0, 20, 1, at(0.6))).toEqual([[0.6, 0]]);
    expect(cache.crossingPoints(10, 1, 20, 1, at(0.7))).toEqual([[0.7, 0]]);
  });
});

describe("crossings after a replan (MP-P4)", () => {
  it("match a fresh plan when a decision moves a way another one crosses", () => {
    // Imported sidewalk 20 traces base footway 10 0.5 m north; imported path 40 crosses both.
    // Replacing moves 20's ends onto the base nodes, so 40 crosses it at a new point.
    const base = osm(
      "base",
      [
        { id: 1, lon: 0, lat: 0 },
        { id: 2, lon: 0.001, lat: 0 },
      ],
      [{ id: 10, refs: [1, 2], tags: footway }],
    );
    const patch = osm(
      "patch",
      [
        { id: 101, lon: 0, lat: 0.5 * M },
        { id: 102, lon: 0.001, lat: 0.9 * M },
        { id: 201, lon: 0.0004, lat: -0.001 },
        { id: 202, lon: 0.0004, lat: 0.001 },
      ],
      [
        { id: 20, refs: [101, 102], tags: { ...footway, footway: "sidewalk" } },
        { id: 40, refs: [201, 202], tags: footway },
      ],
    );
    const options = {
      automation: "conservative" as const,
      matching: {
        propertyKeys: [],
        attachNetwork: true,
        maxDistanceMeters: 1,
        allowWayReplacement: true,
        replacementToleranceMeters: 1,
      },
    };
    const crossings = (plan: ReturnType<typeof planMerge>) =>
      [...plan.proposals.values()]
        .filter(({ kind }) => kind.startsWith("crossing"))
        .map((proposal) => JSON.stringify(proposal))
        .toSorted();
    const accept = [{ proposalId: "replace:w20>w10", action: "accept" as const }];
    const replanned = planMerge(base, patch, options, () => {});
    expect(findProposal(replanned, "replace:w20>w10").status).toBe("review");
    const before = crossings(replanned);
    setMergePlanDecisions(replanned, accept);
    const fresh = planMerge(base, patch, { ...options, decisions: accept }, () => {});
    expect(crossings(replanned)).toEqual(crossings(fresh));
    expect(crossings(replanned)).not.toEqual(before);
    setMergePlanDecisions(replanned, []);
    expect(crossings(replanned)).toEqual(before);
  });
});
