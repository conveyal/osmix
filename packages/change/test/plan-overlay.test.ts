import { Osm } from "@osmix/core";
import type { GeoBbox2D, OsmNode, OsmWay } from "@osmix/types";
import { describe, expect, it } from "vitest";

import { applyChangesetToOsm } from "../src/apply-changeset.ts";
import { OsmChangeset } from "../src/changeset.ts";
import { GridIndex } from "../src/plan/grid-index.ts";
import type { PlanOverlay } from "../src/plan/overlay.ts";

function mulberry32(seed: number): () => number {
  let state = seed;
  return () => {
    state = (state + 0x6d2b79f5) | 0;
    let value = Math.imul(state ^ (state >>> 15), 1 | state);
    value = (value + Math.imul(value ^ (value >>> 7), 61 | value)) ^ value;
    return ((value ^ (value >>> 14)) >>> 0) / 4_294_967_296;
  };
}

const ORIGIN: [number, number] = [7.42, 43.73];
const SPAN = 0.02;

function randomCoordinate(random: () => number): [number, number] {
  // OSM precision, so the materialized dataset stores exactly these values.
  const at = (origin: number) => Math.round((origin + random() * SPAN) * 1e7) / 1e7;
  return [at(ORIGIN[0]), at(ORIGIN[1])];
}

function randomBase(random: () => number) {
  const osm = new Osm({ id: "base" });
  for (let id = 1; id <= 200; id++) {
    const [lon, lat] = randomCoordinate(random);
    osm.nodes.addNode({ id, lon, lat });
  }
  osm.nodes.buildIndex();
  for (let id = 1; id <= 60; id++) {
    const refs = Array.from({ length: 2 + Math.floor(random() * 3) }, () => pickId(random, 200));
    osm.ways.addWay({ id, refs, tags: { building: "yes" } });
  }
  osm.buildIndexes();
  osm.buildSpatialIndexes();
  return osm;
}

const pickId = (random: () => number, count: number) => 1 + Math.floor(random() * count);
const pick = <T>(random: () => number, items: readonly T[]) =>
  items[Math.floor(random() * items.length)];

const comparableWay = (way: OsmWay) => ({ id: way.id, refs: [...way.refs], tags: way.tags ?? {} });

/** Apply one random change through the changeset (and so through its overlay). */
function randomChange(random: () => number, changeset: OsmChangeset, nextId: { value: number }) {
  const overlay = changeset.overlay;
  const nodes = [...currentNodes(overlay)];
  const ways = [...overlay.ways()];
  const created = (type: "node" | "way", id: number) =>
    changeset.changes(type)[id]?.changeType === "create";
  const referenced = new Set(ways.flatMap((way) => way.refs));
  const roll = random();
  if (roll < 0.15) {
    const [lon, lat] = randomCoordinate(random);
    changeset.create({ id: nextId.value--, lon, lat }, "patch");
  } else if (roll < 0.35) {
    const node = pick(random, nodes);
    if (!node) return;
    const [lon, lat] = randomCoordinate(random);
    changeset.modify("node", node.id, (current) => ({ ...current, lon, lat }));
  } else if (roll < 0.45) {
    const node = pick(
      random,
      nodes.filter((candidate) => !referenced.has(candidate.id)),
    );
    if (!node) return;
    if (created("node", node.id)) overlay.discard("node", node.id);
    else changeset.delete(node);
  } else if (roll < 0.6) {
    const refs = Array.from(
      { length: 2 + Math.floor(random() * 3) },
      () => pick(random, nodes)!.id,
    );
    changeset.create({ id: nextId.value--, refs, tags: { building: "yes" } }, "patch");
  } else if (roll < 0.8) {
    const way = pick(random, ways);
    if (!way) return;
    const refs = Array.from(
      { length: 2 + Math.floor(random() * 3) },
      () => pick(random, nodes)!.id,
    );
    changeset.modify("way", way.id, (current) => ({ ...current, refs }));
  } else if (roll < 0.87) {
    const way = pick(random, ways);
    if (!way) return;
    changeset.modify("way", way.id, (current) => ({
      ...current,
      tags: { ...current.tags, name: `n${Math.floor(random() * 10)}` },
    }));
  } else {
    const way = pick(random, ways);
    if (!way) return;
    if (created("way", way.id)) overlay.discard("way", way.id);
    else changeset.delete(way);
  }
}

function* currentNodes(overlay: PlanOverlay): Generator<OsmNode> {
  for (const node of overlay.base.nodes) {
    const current = overlay.getNode(node.id);
    if (current) yield current;
  }
  for (const change of Object.values(overlay.nodeChanges)) {
    if (change.changeType === "create") yield change.entity;
  }
}

function randomBbox(random: () => number): GeoBbox2D {
  const [lon, lat] = randomCoordinate(random);
  const size = random() * SPAN * 0.3;
  return [lon, lat, lon + size, lat + size];
}

/** Every overlay read must equal the same read on the materialized dataset. */
function expectOverlayMatches(random: () => number, changeset: OsmChangeset) {
  const overlay = changeset.overlay;
  const result = applyChangesetToOsm(changeset);

  expect(overlay.nodeCount).toBe(result.nodes.size);
  for (const node of result.nodes) expect(overlay.getNode(node.id)).toMatchObject(node);
  for (const id of Object.keys(overlay.nodeChanges).map(Number)) {
    expect(overlay.getNode(id) ?? null).toEqual(result.nodes.getById(id) ?? null);
  }
  const overlayWays = [...overlay.ways()].map(comparableWay).sort((a, b) => a.id - b.id);
  const resultWays = [...result.ways].map(comparableWay).sort((a, b) => a.id - b.id);
  expect(overlayWays).toEqual(resultWays);

  for (const way of result.ways) {
    const coordinates = way.refs.map((ref) => {
      const node = result.nodes.getById(ref)!;
      return [node.lon, node.lat];
    });
    expect(overlay.wayCoordinates(overlay.getWay(way.id)!)).toEqual(coordinates);
  }

  for (let sample = 0; sample < 10; sample++) {
    const node = pick(random, [...result.nodes]);
    if (!node) break;
    const expected = [...result.ways].filter((way) => way.refs.includes(node.id));
    expect(
      overlay
        .waysAtNode(node.id)
        .map((way) => way.id)
        .sort((a, b) => a - b),
    ).toEqual(expected.map((way) => way.id).sort((a, b) => a - b));

    const [lon, lat] = randomCoordinate(random);
    const meters = 50 + random() * 400;
    expect(overlay.nodesWithinRadius(lon, lat, meters).map((match) => match.id)).toEqual(
      result.nodes
        .findIndexesWithinRadius(lon, lat, meters / 1_000)
        .map((index) => result.nodes.ids.at(index)),
    );

    const bbox = randomBbox(random);
    expect(overlay.waysIntersecting(bbox).map((way) => way.id)).toEqual(
      result.ways
        .intersects(bbox)
        .map((index) => result.ways.ids.at(index))
        .sort((a, b) => a - b),
    );
  }
}

describe("PlanOverlay", () => {
  it.each([1, 2, 3, 4, 5])(
    "reads the same as the materialized dataset across random changes (seed %i)",
    (seed) => {
      const random = mulberry32(seed);
      const changeset = new OsmChangeset(randomBase(random));
      const nextId = { value: -1 };
      // Query early on some seeds, so pending geometry is built and then maintained on every
      // change, and late on others, so it is built from many records at once.
      if (seed % 2 === 1) expectOverlayMatches(random, changeset);
      for (let round = 0; round < 6; round++) {
        for (let step = 0; step < 25; step++) randomChange(random, changeset, nextId);
        expectOverlayMatches(random, changeset);
      }
    },
  );

  it("counts nodes as the planned dataset would", () => {
    const random = mulberry32(9);
    const changeset = new OsmChangeset(randomBase(random));
    changeset.create({ id: -1, lon: ORIGIN[0], lat: ORIGIN[1] }, "patch");
    changeset.delete(changeset.overlay.getNode(1)!);
    changeset.overlay.discard("node", 1);
    expect(changeset.overlay.nodeCount).toBe(201);
    expect(changeset.overlay.getNode(1)).toMatchObject({ id: 1 });
  });
});

describe("GridIndex", () => {
  it("moves, removes, and always returns boxes spanning many cells", () => {
    const grid = new GridIndex(0.01);
    grid.set(1, [0, 0, 0.001, 0.001]);
    grid.set(2, [0, 0, 1, 1]);
    expect([...grid.query([0.0005, 0.0005, 0.0005, 0.0005])].sort((a, b) => a - b)).toEqual([1, 2]);
    expect([...grid.query([0.5, 0.5, 0.5, 0.5])]).toEqual([2]);
    grid.set(1, [0.5, 0.5, 0.5, 0.5]);
    expect([...grid.query([0.0005, 0.0005, 0.0005, 0.0005])]).toEqual([2]);
    grid.remove(2);
    expect([...grid.query([0.5, 0.5, 0.5, 0.5])]).toEqual([1]);
    expect(grid.size).toBe(1);
  });
});
