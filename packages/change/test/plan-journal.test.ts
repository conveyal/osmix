import { Osm } from "@osmix/core";
import type { GeoBbox2D, OsmTags } from "@osmix/types";
import { describe, expect, it } from "vitest";

import { PlanOverlay } from "../src/plan/overlay.ts";

function mulberry32(seed: number): () => number {
  let state = seed;
  return () => {
    state = (state + 0x6d2b79f5) | 0;
    let value = Math.imul(state ^ (state >>> 15), 1 | state);
    value = (value + Math.imul(value ^ (value >>> 7), 61 | value)) ^ value;
    return ((value ^ (value >>> 14)) >>> 0) / 4_294_967_296;
  };
}

/** A 5×5 grid of nodes with a highway along each row. */
function grid() {
  const osm = new Osm({ id: "base" });
  for (let y = 0; y < 5; y++) {
    for (let x = 0; x < 5; x++)
      osm.nodes.addNode({ id: 1 + x + y * 5, lon: x * 0.001, lat: y * 0.001 });
    osm.ways.addWay({
      id: 100 + y,
      refs: [0, 1, 2, 3, 4].map((x) => 1 + x + y * 5),
      tags: { highway: "footway" },
    });
  }
  osm.relations.addRelation({
    id: 500,
    tags: { type: "route" },
    members: [{ type: "way", ref: 100, role: "" }],
  });
  osm.buildIndexes();
  osm.buildSpatialIndexes();
  return osm;
}

type Write = (overlay: PlanOverlay) => void;

/** A random write, as a function so it can be replayed on another overlay. */
function randomWrite(overlay: PlanOverlay, random: () => number, next: { id: number }): Write {
  const pick = <T>(items: readonly T[]) => items[Math.floor(random() * items.length)]!;
  const nodes = [...overlay.nodes()].map(({ id }) => id);
  const ways = [...overlay.ways()].map(({ id }) => id);
  const created = (type: "node" | "way", id: number) =>
    overlay.changes(type)[id]?.changeType === "create";
  const roll = random();
  if (roll < 0.2) {
    const id = --next.id;
    const [lon, lat] = [random() * 0.004, random() * 0.004];
    return (target) => target.create({ id, lon, lat }, "patch");
  }
  if (roll < 0.35 && nodes.length > 1) {
    const id = --next.id;
    const refs = [pick(nodes), pick(nodes)];
    const tags: OsmTags = { highway: "path" };
    return (target) => target.create({ id, refs, tags }, "patch");
  }
  if (roll < 0.5 && ways.length > 0) {
    const id = pick(ways);
    const ref = pick(nodes);
    return (target) =>
      target.modify("way", id, (way) => ({ ...way, refs: [...way.refs.slice(0, 2), ref] }));
  }
  if (roll < 0.62 && nodes.length > 0) {
    const id = pick(nodes);
    const shift = random() * 0.0005;
    return (target) => target.modify("node", id, (node) => ({ ...node, lon: node.lon + shift }));
  }
  if (roll < 0.72 && nodes.length > 0) {
    const id = pick(nodes);
    return (target) => target.modify("node", id, (node) => ({ ...node, tags: { kerb: "flush" } }));
  }
  if (roll < 0.82 && ways.length > 0) {
    const id = pick(ways);
    // Drop a created way (a tombstone), delete any other.
    return created("way", id)
      ? (target) => target.discard("way", id)
      : (target) => target.delete(target.getWay(id)!);
  }
  if (roll < 0.92 && nodes.length > 0) {
    const id = pick(nodes);
    return created("node", id)
      ? (target) => target.discard("node", id)
      : (target) => target.delete(target.getNode(id)!);
  }
  return (target) =>
    target.modify("relation", 500, (relation) => ({
      ...relation,
      tags: { type: "route", n: "1" },
    }));
}

/** Everything a phase can read from an overlay, in order. */
function observe(overlay: PlanOverlay) {
  const boxes: GeoBbox2D[] = [
    [0, 0, 0.002, 0.002],
    [0.001, 0.001, 0.004, 0.004],
    [0, 0, 0.004, 0.004],
  ];
  return {
    records: (["node", "way", "relation"] as const).map((type) =>
      Object.entries(overlay.changes(type)),
    ),
    nodes: [...overlay.nodes()],
    ways: [...overlay.ways()].map((way) => [way, overlay.wayCoordinates(way)]),
    relations: [...overlay.relations()],
    near: boxes.map((box) => overlay.wayIdsIntersecting(box)),
    radius: overlay.nodesWithinRadius(0.002, 0.002, 200).map(({ id }) => id),
    nodeCount: overlay.nodeCount,
    minNodeId: overlay.minNodeId(),
  };
}

describe("journaled overlay (MP-P4)", () => {
  it.each([1, 2, 3, 4, 5, 6])("undoes back to a mark exactly (seed %i)", (seed) => {
    const random = mulberry32(seed);
    const base = grid();
    const overlay = new PlanOverlay(base);
    const fresh = new PlanOverlay(base);
    const next = { id: 0 };
    const first = overlay.mark();
    for (let step = 0; step < 25; step++) {
      const write = randomWrite(overlay, random, next);
      write(overlay);
      write(fresh);
    }
    // Spatial and coordinate caches are warm before the writes that get undone.
    observe(overlay);
    const mark = overlay.mark();
    const earlier = overlay.stateAt(mark);
    const expected = observe(fresh);
    for (let step = 0; step < 25; step++) randomWrite(overlay, random, next)(overlay);
    // The earlier state reads as it was, while the later writes stand.
    for (const node of expected.nodes) expect(earlier.getNode(node.id)).toEqual(node);
    for (const [way] of expected.ways) {
      const id = (way as { id: number }).id;
      expect(earlier.getWay(id)).toEqual(way);
    }
    overlay.undoTo(mark);
    expect(observe(overlay)).toEqual(expected);
    // A mark stays valid after an undo to it.
    randomWrite(overlay, random, next)(overlay);
    overlay.undoTo(mark);
    expect(observe(overlay)).toEqual(expected);
    overlay.undoTo(first);
    expect(observe(overlay)).toEqual(observe(new PlanOverlay(base)));
  });

  it("keeps a dropped record's place, so re-creating it reads in the same order", () => {
    const overlay = new PlanOverlay(grid());
    overlay.create({ id: -1, lon: 0, lat: 0 }, "patch");
    overlay.create({ id: -2, lon: 0, lat: 0 }, "patch");
    const mark = overlay.mark();
    overlay.discard("node", -1);
    expect(Object.keys(overlay.nodeChanges)).toEqual(["-1", "-2"]);
    expect(overlay.getNode(-1)).toBeNull();
    overlay.undoTo(mark);
    expect(Object.keys(overlay.nodeChanges)).toEqual(["-1", "-2"]);
    expect(overlay.getNode(-1)).toMatchObject({ id: -1 });
  });

  it("keeps cached coordinates of ways an undo does not touch", () => {
    const base = grid();
    const overlay = new PlanOverlay(base);
    const mark = overlay.mark();
    const untouched = overlay.wayCoordinates(base.ways.getById(104)!);
    overlay.modify("node", 1, (node) => ({ ...node, lon: 0.0001 }));
    expect(overlay.wayCoordinates(overlay.getWay(100)!)?.[0]).toEqual([0.0001, 0]);
    overlay.undoTo(mark);
    expect(overlay.wayCoordinates(overlay.getWay(100)!)?.[0]).toEqual([0, 0]);
    expect(overlay.wayCoordinates(base.ways.getById(104)!)).toBe(untouched);
  });

  it("refuses a mark it cannot undo to", () => {
    const overlay = new PlanOverlay(grid());
    expect(() => overlay.undoTo(0)).toThrow("No overlay mark 0 to undo to");
  });
});
