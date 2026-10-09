import { Osm } from "@osmix/core";
import type { OsmNode, OsmWay } from "@osmix/types";
import { describe, expect, it } from "vitest";

import { planMerge } from "../src/plan/plan.ts";
import type { MergePlanOptions } from "../src/plan/types.ts";
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

/** A base footway 60 m east along the equator, with vertices every 10 m. */
function base() {
  const ids = [1, 2, 3, 4, 5, 6, 7];
  return osm(
    "base",
    ids.map((id, index) => ({ id, lon: index * 10 * M, lat: 0 })),
    [{ id: 10, refs: ids, tags: footway }],
  );
}

/**
 * An imported footway 0.6 m north of the base footway from `from` to `to` meters, with a vertex
 * next to each base vertex, then turning away north at its east end.
 */
function copy(
  from: number,
  to: number,
  extra: { nodes: OsmNode[]; ways: OsmWay[] } = { nodes: [], ways: [] },
) {
  const nodes: OsmNode[] = [];
  for (let meters = from; meters <= to; meters += 10) {
    nodes.push({ id: 100 + meters / 10, lon: meters * M, lat: 0.6 * M });
  }
  nodes.push({ id: 199, lon: to * M, lat: 30 * M });
  return osm(
    "patch",
    [...nodes, ...extra.nodes],
    [{ id: 20, refs: nodes.map(({ id }) => id), tags: footway }, ...extra.ways],
  );
}

const options = (traceLengthMeters?: number): MergePlanOptions => ({
  createIntersections: false,
  matching: {
    propertyKeys: [],
    attachNetwork: true,
    maxDistanceMeters: 1,
    ...(traceLengthMeters ? { traceLengthMeters } : {}),
  },
});

describe("connections along a copy of a base path (MP-M1)", () => {
  it("blocks points of a parallel copy, and they compete with nothing", () => {
    const plan = planMerge(base(), copy(0, 40), options(), () => {});
    // Interior points 10-30 m along run beside the base footway: welding them makes a ladder.
    for (const id of [101, 102, 103]) {
      expect(findProposal(plan, `connect:n${id}>n${id - 99}`)).toMatchObject({
        status: "blocked",
        reasons: expect.arrayContaining(["traces-base-way"]),
        effect: "blocked",
      });
    }
    // The way's start meets the base path where it begins: an ordinary connection.
    expect(findProposal(plan, "connect:n100>n1")).toMatchObject({
      status: "automatic",
      reasons: [],
      effect: "applied",
    });
    expect(plan.summary.features["needs-decision"]).toBe(0);
  });

  it("lets a way's end take a base point a copy's point is also near", () => {
    // A spur ends 0.5 m south of base node 3, which the copy's point 102 is 0.6 m north of.
    const patch = copy(0, 40, {
      nodes: [
        { id: 301, lon: 20 * M, lat: -0.5 * M },
        { id: 302, lon: 20 * M, lat: -30 * M },
      ],
      ways: [{ id: 30, refs: [301, 302], tags: footway }],
    });
    const plan = planMerge(base(), patch, options(), () => {});
    expect(findProposal(plan, "connect:n102>n3").status).toBe("blocked");
    expect(findProposal(plan, "connect:n301>n3")).toMatchObject({
      status: "automatic",
      reasons: [],
      competitors: [],
      effect: "applied",
    });
  });

  it("connects a point that only touches the base path for a short stretch", () => {
    // A path that dips to within 0.6 m of the base path at one point and leaves again.
    const touching = osm(
      "patch",
      [
        { id: 101, lon: 35 * M, lat: 20 * M },
        { id: 102, lon: 40 * M, lat: 0.6 * M },
        { id: 103, lon: 45 * M, lat: 20 * M },
      ],
      [{ id: 20, refs: [101, 102, 103], tags: footway }],
    );
    const plan = planMerge(base(), touching, options(), () => {});
    expect(findProposal(plan, "connect:n102>n5").reasons).not.toContain("traces-base-way");
  });

  it("takes the trace length from the options", () => {
    const short = copy(0, 20);
    expect(
      findProposal(
        planMerge(base(), short, options(), () => {}),
        "connect:n101>n2",
      ).reasons,
    ).toContain("traces-base-way");
    expect(
      findProposal(
        planMerge(base(), short, options(50), () => {}),
        "connect:n101>n2",
      ).reasons,
    ).not.toContain("traces-base-way");
  });

  it("does not check the angle where a way ends on the base path", () => {
    const spur = osm(
      "patch",
      [
        { id: 101, lon: 20 * M, lat: 0.5 * M },
        { id: 102, lon: 20 * M, lat: 30 * M },
      ],
      [{ id: 20, refs: [101, 102], tags: footway }],
    );
    const plan = planMerge(base(), spur, options(), () => {});
    expect(findProposal(plan, "connect:n101>n3")).toMatchObject({
      status: "automatic",
      reasons: [],
    });
  });
});
