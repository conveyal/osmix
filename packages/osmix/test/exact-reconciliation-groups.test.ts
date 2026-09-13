import { describe, expect, it } from "vitest";

import {
  fromPbf,
  merge,
  Osm,
  type OsmNode,
  type OsmRelation,
  type OsmWay,
  OsmixWorker,
  toPbfBuffer,
} from "../src/index";

const options = { directMerge: true, deduplicateNodes: true, deduplicateWays: true };

function dataset(id: string, nodes: OsmNode[], ways: OsmWay[] = [], relations: OsmRelation[] = []) {
  const osm = new Osm({ id });
  for (const node of nodes) osm.nodes.addNode(node);
  for (const way of ways) osm.ways.addWay(way);
  for (const relation of relations) osm.relations.addRelation(relation);
  osm.buildIndexes();
  osm.buildSpatialIndexes();
  return osm;
}

function entities(...datasets: Osm[]) {
  return {
    nodes: datasets
      .flatMap((osm) => [...osm.nodes])
      .sort((a, b) => a.id - b.id)
      .map(({ id, lon, lat, tags }) => ({ id, lon, lat, tags: tags ?? {} })),
    ways: datasets
      .flatMap((osm) => [...osm.ways])
      .sort((a, b) => a.id - b.id)
      .map(({ id, refs, tags }) => ({ id, refs, tags: tags ?? {} })),
    relations: datasets
      .flatMap((osm) => [...osm.relations])
      .sort((a, b) => a.id - b.id)
      .map(({ id, members, tags }) => ({ id, members, tags: tags ?? {} })),
  };
}

function conflictingInputs(cafeId = 101, schoolId = 102, reverse = false, extra = false) {
  const base = dataset("exact-base", [{ id: 1, lon: 0, lat: 0 }]);
  const nodes: OsmNode[] = [
    { id: cafeId, lon: 0, lat: 0, tags: { amenity: "cafe", name: "Imported cafe" } },
    { id: schoolId, lon: 0, lat: 0, tags: { amenity: "school", name: "Imported school" } },
    { id: 201, lon: 0.001, lat: 0 },
    { id: 202, lon: 0, lat: 0.001 },
  ];
  if (extra)
    nodes.push({ id: 103, lon: 0, lat: 0 }, { id: 104, lon: 0, lat: 0, tags: { amenity: "cafe" } });
  const patch = dataset(
    "exact-import",
    reverse ? nodes.toReversed() : nodes,
    [
      { id: 10, refs: [cafeId, 201], tags: { highway: "footway", name: "Cafe approach" } },
      { id: 20, refs: [schoolId, 202], tags: { highway: "footway", name: "School approach" } },
    ],
    [
      {
        id: 30,
        tags: { type: "route", route: "foot" },
        members: [
          { type: "node", ref: cafeId, role: "stop" },
          { type: "node", ref: schoolId, role: "stop" },
          { type: "way", ref: 10, role: "" },
          { type: "way", ref: 20, role: "" },
        ],
      },
    ],
  );
  return { base, patch };
}

class TestWorker extends OsmixWorker {
  add(osm: Osm) {
    this.set(osm.id, osm);
  }
  getOsm(id: string) {
    return this.get(id);
  }
}

async function expectRoundTrip(result: Osm, expected: ReturnType<typeof entities>) {
  expect(entities(result)).toEqual(expected);
  const reloaded = await fromPbf(await toPbfBuffer(result), { id: "exact-reloaded" });
  expect(entities(reloaded)).toEqual(expected);
}

describe("exact reconciliation groups through the facade and worker", () => {
  it.each([
    { cafeId: 101, schoolId: 102, reverse: false },
    { cafeId: 101, schoolId: 102, reverse: true },
    { cafeId: 102, schoolId: 101, reverse: false },
    { cafeId: 102, schoolId: 101, reverse: true },
  ])("preserves incompatible imports and references through merge/PBF: %o", async (order) => {
    const { base, patch } = conflictingInputs(order.cafeId, order.schoolId, order.reverse);
    const baseBefore = entities(base);
    const patchBefore = entities(patch);
    const expected = entities(base, patch);
    const result = await merge(base, patch, options, () => {});
    await expectRoundTrip(result, expected);
    expect(entities(base)).toEqual(baseBefore);
    expect(entities(patch)).toEqual(patchBefore);
  });

  it("retains every contender, including an untagged import, when the group conflicts", async () => {
    const { base, patch } = conflictingInputs(101, 102, true, true);
    await expectRoundTrip(await merge(base, patch, options, () => {}), entities(base, patch));
  });

  it("preserves the conflicting group through worker merge and worker PBF export", async () => {
    const { base, patch } = conflictingInputs();
    const expected = entities(base, patch);
    const worker = new TestWorker();
    worker.add(base);
    worker.add(patch);
    await worker.merge(base.id, patch.id, options);
    expect(entities(worker.getOsm(base.id))).toEqual(expected);
    const reloaded = await fromPbf(await worker.toPbf(base.id), { id: "worker-reloaded" });
    expect(entities(reloaded)).toEqual(expected);
  });

  it("still reconciles compatible imports and rewrites their way and relation references", async () => {
    const base = dataset("compatible-base", [{ id: 1, lon: 0, lat: 0 }]);
    const patch = dataset(
      "compatible-import",
      [
        { id: 101, lon: 0, lat: 0, tags: { amenity: "cafe" } },
        { id: 102, lon: 0, lat: 0, tags: { name: "Cafe" } },
        { id: 201, lon: 0.001, lat: 0 },
        { id: 202, lon: 0, lat: 0.001 },
      ],
      [
        { id: 10, refs: [101, 201], tags: { highway: "footway" } },
        { id: 20, refs: [102, 202], tags: { highway: "footway" } },
      ],
      [
        {
          id: 30,
          members: [
            { type: "node", ref: 101, role: "label" },
            { type: "node", ref: 102, role: "entrance" },
          ],
        },
      ],
    );
    const expected = dataset(
      "compatible-expected",
      [
        { id: 1, lon: 0, lat: 0, tags: { amenity: "cafe", name: "Cafe" } },
        { id: 201, lon: 0.001, lat: 0 },
        { id: 202, lon: 0, lat: 0.001 },
      ],
      [
        { id: 10, refs: [1, 201], tags: { highway: "footway" } },
        { id: 20, refs: [1, 202], tags: { highway: "footway" } },
      ],
      [
        {
          id: 30,
          members: [
            { type: "node", ref: 1, role: "label" },
            { type: "node", ref: 1, role: "entrance" },
          ],
        },
      ],
    );
    await expectRoundTrip(await merge(base, patch, options, () => {}), entities(expected));
  });

  it("keeps same-ID classification changes authoritative in worker merges", async () => {
    const base = dataset(
      "same-id-base",
      [
        { id: 1, lon: 0, lat: 0, tags: { amenity: "cafe", name: "Old cafe" } },
        { id: 2, lon: 0.001, lat: 0 },
      ],
      [{ id: 10, refs: [1, 2], tags: { highway: "footway" } }],
    );
    const patch = dataset("same-id-import", [
      { id: 1, lon: 0, lat: 0, tags: { amenity: "school", name: "New school" } },
    ]);
    const worker = new TestWorker();
    worker.add(base);
    worker.add(patch);
    await worker.merge(base.id, patch.id, options);
    const expected = dataset(
      "same-id-expected",
      [...patch.nodes, { id: 2, lon: 0.001, lat: 0 }],
      [...base.ways],
    );
    await expectRoundTrip(worker.getOsm(base.id), entities(expected));
  });

  it("does not normalize coincident entities within either original input", async () => {
    const base = dataset("distinct-base", [
      { id: 1, lon: 0, lat: 0, tags: { amenity: "cafe" } },
      { id: 2, lon: 0, lat: 0, tags: { amenity: "cafe" } },
    ]);
    const patch = dataset("distinct-import", [
      { id: 101, lon: 1, lat: 1, tags: { amenity: "school" } },
      { id: 102, lon: 1, lat: 1, tags: { amenity: "school" } },
    ]);
    await expectRoundTrip(await merge(base, patch, options, () => {}), entities(base, patch));
  });
});
