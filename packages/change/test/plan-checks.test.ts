import { Osm } from "@osmix/core";
import { defaultHighwayFilter, defaultPedestrianFilter, routingTopologyStats } from "@osmix/router";
import type { OsmTags } from "@osmix/types";
import { describe, expect, it } from "vitest";

import {
  newOverlayIntegrityIssues,
  newRoutingIntegrityIssues,
  routingIntegrityIssueKeys,
} from "../src/integrity.ts";
import { PlanOverlay } from "../src/plan/overlay.ts";
import { PlannedRoutingStats } from "../src/plan/validate.ts";

const walk = (tags?: OsmTags) => defaultHighwayFilter(tags) || defaultPedestrianFilter(tags);

function mulberry32(seed: number): () => number {
  let state = seed;
  return () => {
    state = (state + 0x6d2b79f5) | 0;
    let value = Math.imul(state ^ (state >>> 15), 1 | state);
    value = (value + Math.imul(value ^ (value >>> 7), 61 | value)) ^ value;
    return ((value ^ (value >>> 14)) >>> 0) / 4_294_967_296;
  };
}

const GRADES: OsmTags[] = [{}, { bridge: "yes", layer: "1" }, { tunnel: "yes", layer: "-1" }];
const KINDS = ["footway", "residential", "service", "cycleway"];

/** A grid of nodes with highways along rows and columns, and a few turn restrictions. */
function grid(random: () => number) {
  const osm = new Osm({ id: "base" });
  const size = 6;
  const nodeId = (x: number, y: number) => 1 + x + y * size;
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      osm.nodes.addNode({ id: nodeId(x, y), lon: x * 0.001, lat: y * 0.001 });
    }
  }
  let wayId = 100;
  const pick = <T>(items: readonly T[]) => items[Math.floor(random() * items.length)]!;
  const tags = (): OsmTags => ({ highway: pick(KINDS), ...pick(GRADES) });
  for (let y = 0; y < size; y++) {
    osm.ways.addWay({ id: wayId++, refs: [0, 1, 2].map((x) => nodeId(x, y)), tags: tags() });
    osm.ways.addWay({ id: wayId++, refs: [2, 3, 4, 5].map((x) => nodeId(x, y)), tags: tags() });
  }
  for (let x = 0; x < size; x++) {
    osm.ways.addWay({ id: wayId++, refs: [0, 1, 2, 3].map((y) => nodeId(x, y)), tags: tags() });
    osm.ways.addWay({ id: wayId++, refs: [3, 4, 5].map((y) => nodeId(x, y)), tags: tags() });
  }
  osm.relations.addRelation({
    id: 500,
    tags: { type: "restriction", restriction: "no_left_turn" },
    members: [
      { type: "way", ref: 100, role: "from" },
      { type: "node", ref: nodeId(2, 0), role: "via" },
      { type: "way", ref: 101, role: "to" },
    ],
  });
  osm.relations.addRelation({
    id: 501,
    tags: { type: "route", route: "foot" },
    members: [
      { type: "way", ref: 112, role: "" },
      { type: "node", ref: nodeId(3, 3), role: "" },
    ],
  });
  osm.buildIndexes();
  osm.buildSpatialIndexes();
  return osm;
}

/** One random write: rewire, retag, delete or create ways, nodes and relations. */
function randomWrite(overlay: PlanOverlay, random: () => number, next: { id: number }) {
  const pick = <T>(items: readonly T[]) => items[Math.floor(random() * items.length)]!;
  const ways = [...overlay.ways()];
  const nodes = [...overlay.nodes()];
  const relations = [...overlay.relations()];
  const roll = random();
  if (roll < 0.25 && ways.length > 0) {
    // Splice in, drop, or move a vertex.
    const way = pick(ways);
    const refs = [...way.refs];
    const at = Math.floor(random() * refs.length);
    if (random() < 0.5) refs.splice(at, 0, pick(nodes).id);
    else refs.splice(at, 1);
    overlay.modify("way", way.id, (current) => ({ ...current, refs }));
  } else if (roll < 0.4 && ways.length > 0) {
    const way = pick(ways);
    overlay.modify("way", way.id, (current) => ({
      ...current,
      tags: { highway: pick(KINDS), ...pick(GRADES) },
    }));
  } else if (roll < 0.5 && ways.length > 0) {
    overlay.delete(pick(ways));
  } else if (roll < 0.6 && nodes.length > 0) {
    overlay.delete(pick(nodes));
  } else if (roll < 0.75) {
    const node = { id: --next.id, lon: random() * 0.005, lat: random() * 0.005 };
    overlay.create(node, "patch");
    const refs = [node.id, pick(nodes).id];
    overlay.create(
      { id: --next.id, refs, tags: { highway: pick(KINDS), ...pick(GRADES) } },
      "patch",
    );
  } else if (roll < 0.85 && ways.length > 1) {
    overlay.create(
      {
        id: --next.id,
        tags: { type: "restriction", restriction: "no_u_turn" },
        members: [
          { type: "way", ref: pick(ways).id, role: "from" },
          { type: "node", ref: pick(nodes).id, role: "via" },
          { type: "way", ref: pick(ways).id, role: "to" },
        ],
      },
      "patch",
    );
  } else if (relations.length > 0) {
    const relation = pick(relations);
    if (random() < 0.5) overlay.delete(relation);
    else {
      overlay.modify("relation", relation.id, (current) => ({
        ...current,
        members: current.members.slice(1),
      }));
    }
  }
}

function fullStats(overlay: PlanOverlay) {
  const source = { nodeCount: overlay.nodeCount, ways: () => overlay.ways() };
  return {
    car: routingTopologyStats(source, defaultHighwayFilter),
    walk: routingTopologyStats(source, walk),
  };
}

describe("scoped plan checks (MP-V1)", () => {
  it.each([1, 2, 3, 4, 5])(
    "equal the full checks after random writes (seed %i)",
    (seed) => {
      const random = mulberry32(seed);
      const base = grid(random);
      const baseline = routingIntegrityIssueKeys(base);
      const overlay = new PlanOverlay(base);
      // Odd seeds leave some base ways out from the start, as a plan's replacements do.
      const planned = new PlannedRoutingStats(base, seed % 2 ? [100, 105, 113] : []);
      const next = { id: 0 };
      for (let step = 0; step < 60; step++) {
        randomWrite(overlay, random, next);
        const full = newRoutingIntegrityIssues(baseline, overlay.reader()).toSorted();
        expect(newOverlayIntegrityIssues(baseline, overlay).toSorted(), `step ${step}`).toEqual(
          full,
        );
        expect(planned.stats(overlay), `step ${step}`).toEqual(fullStats(overlay));
      }
    },
    30_000,
  );

  it("finds what an unchanged base way gets from a deleted node or a changed neighbour", () => {
    const random = mulberry32(9);
    const base = grid(random);
    const baseline = routingIntegrityIssueKeys(base);
    const overlay = new PlanOverlay(base);
    // Deleting a node leaves every base way through it with a missing node.
    overlay.delete(base.nodes.getById(8)!);
    // Shortening the restriction's from way detaches it from its via node.
    overlay.modify("way", 100, (way) => ({ ...way, refs: way.refs.slice(0, 2) }));
    const issues = newOverlayIntegrityIssues(baseline, overlay);
    expect(issues).toEqual(newRoutingIntegrityIssues(baseline, overlay.reader()).toSorted());
    expect(issues.some((issue) => issue.includes("references missing node 8"))).toBe(true);
    expect(issues.some((issue) => issue.startsWith("restriction 500 via node"))).toBe(true);
  });

  it("sorts issues by key, independent of the order changes were made", () => {
    const random = mulberry32(11);
    const base = grid(random);
    const baseline = routingIntegrityIssueKeys(base);
    const first = new PlanOverlay(base);
    first.delete(base.nodes.getById(8)!);
    first.delete(base.nodes.getById(20)!);
    const second = new PlanOverlay(base);
    second.delete(base.nodes.getById(20)!);
    second.delete(base.nodes.getById(8)!);
    expect(newOverlayIntegrityIssues(baseline, first)).toEqual(
      newOverlayIntegrityIssues(baseline, second),
    );
  });
});
