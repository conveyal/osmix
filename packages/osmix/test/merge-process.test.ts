import { describe, expect, it } from "vitest";

import {
  applyChangesetToOsm,
  fromPbf,
  generateChangeset,
  generateConflationArtifacts,
  merge,
  Osm,
  type OsmConflationDecision,
  type OsmNode,
  type OsmWay,
  toPbfBuffer,
} from "../src/index";

// These IDs and values are the worked examples in docs/merge-process.md.
function dataset(id: string, nodes: OsmNode[], ways: OsmWay[] = []) {
  const osm = new Osm({ id });
  for (const node of nodes) osm.nodes.addNode(node);
  for (const way of ways) osm.ways.addWay(way);
  osm.buildIndexes();
  osm.buildSpatialIndexes();
  return osm;
}

function entities(osm: Osm) {
  return {
    nodes: [...osm.nodes.sorted()],
    ways: [...osm.ways.sorted()],
    relations: [...osm.relations.sorted()],
  };
}

async function expectEntityRoundTrip(osm: Osm) {
  const loaded = await fromPbf(await toPbfBuffer(osm));
  expect(entities(loaded)).toEqual(entities(osm));
}

function baseSidewalk() {
  return dataset(
    "guide-base",
    [
      { id: 1, lon: 0, lat: 0 },
      { id: 2, lon: 0.001, lat: 0 },
    ],
    [{ id: 10, refs: [1, 2], tags: { highway: "footway", name: "Base sidewalk" } }],
  );
}

describe("merge-process guide", () => {
  it("MP-E1 traces direct, exact, matching, and intersections through PBF reload", async () => {
    const base = baseSidewalk();
    const patch = dataset(
      "guide-patch",
      [
        { id: 101, lon: 0, lat: 0 },
        { id: 102, lon: 0.001, lat: 0 },
        { id: 201, lon: 0, lat: 0.000004, tags: { tactile_paving: "yes" } },
        { id: 301, lon: 0.00075, lat: -0.001 },
        { id: 302, lon: 0.00075, lat: 0.001 },
      ],
      [
        { id: 20, refs: [101, 102], tags: { highway: "footway", name: "Survey sidewalk" } },
        { id: 30, refs: [301, 302], tags: { highway: "footway", name: "New link" } },
      ],
    );
    const originalBase = entities(base);
    const originalPatch = entities(patch);
    const direct = applyChangesetToOsm(generateChangeset(base, patch, { directMerge: true }));
    expect(entities(direct)).toEqual({
      nodes: [...originalBase.nodes, ...originalPatch.nodes],
      ways: [...originalBase.ways, ...originalPatch.ways],
      relations: [],
    });

    const nodes = generateChangeset(base, patch, { directMerge: true, deduplicateNodes: true });
    const nodeResult = applyChangesetToOsm(nodes);
    expect([...nodeResult.nodes.sorted()].map((node) => node.id)).toEqual([1, 2, 201, 301, 302]);
    expect(nodeResult.ways.getById(20)?.refs).toEqual([1, 2]);

    const options = { directMerge: true, deduplicateNodes: true, deduplicateWays: true };
    const exact = applyChangesetToOsm(generateChangeset(base, patch, options));
    expect([...exact.ways.sorted()]).toEqual([originalBase.ways[0], originalPatch.ways[1]]);
    expect([...exact.nodes.sorted()]).toEqual([...nodeResult.nodes.sorted()]);

    const conflation = { propertyKeys: ["tactile_paving"], attachNetwork: false };
    const matching = generateConflationArtifacts(base, patch, { ...options, conflation });
    expect(entities(matching.ordinaryBaseline)).toEqual(entities(exact));
    expect(matching.result.nodes.getById(1)).toEqual({
      id: 1,
      lon: 0,
      lat: 0,
      tags: { tactile_paving: "yes" },
    });
    expect([...matching.result.ways.sorted()]).toEqual([...exact.ways.sorted()]);
    expect(matching.result.nodes.getById(201)).toEqual(patch.nodes.getById(201));
    expect(matching.outcome.features.find((feature) => feature.sourceId === 201)).toMatchObject({
      copiedKeys: ["tactile_paving"],
    });

    const final = applyChangesetToOsm(
      generateChangeset(matching.result, patch, { createIntersections: true }),
    );
    expect(final.nodes.getById(303)).toEqual({
      id: 303,
      lon: 0.00075,
      lat: 0,
      tags: { crossing: "yes" },
    });
    expect([...final.nodes.sorted()]).toEqual([
      ...matching.result.nodes.sorted(),
      final.nodes.getById(303),
    ]);
    expect([...final.ways.sorted()]).toEqual([
      { id: 10, refs: [1, 303, 2], tags: { highway: "footway", name: "Base sidewalk" } },
      { id: 30, refs: [301, 303, 302], tags: { highway: "footway", name: "New link" } },
    ]);
    expect(
      entities(
        await merge(base, patch, { ...options, conflation, createIntersections: true }, () => {}),
      ),
    ).toEqual(entities(final));
    expect(entities(base)).toEqual(originalBase);
    expect(entities(patch)).toEqual(originalPatch);
    await expectEntityRoundTrip(final);
  });

  it("MP-E2 distinguishes no-op defaults, whole-entity updates, and absent entities", async () => {
    const base = dataset("first-file", [
      { id: -1, lon: 0, lat: 0, tags: { name: "Old entrance", wheelchair: "yes" } },
      { id: -2, lon: 0.001, lat: 0, tags: { name: "Keep me" } },
    ]);
    const patch = dataset("independent-file", [
      { id: -1, lon: 0.002, lat: 0, tags: { name: "Different entrance" } },
    ]);
    expect(await merge(base, patch)).toBe(base);
    const result = await merge(base, patch, { directMerge: true }, () => {});
    expect([...result.nodes.sorted()]).toEqual([base.nodes.getById(-2), patch.nodes.getById(-1)]);
    expect(result.nodes.getById(-1)?.tags).not.toHaveProperty("wheelchair");
    expect(base.nodes.getById(-1)?.tags).toHaveProperty("wheelchair", "yes");
  });

  it.each(["copy", "connect", "copy-connect-remove"] as const)(
    "MP-E3 compares %s on the same imported sidewalk and branch",
    async (action) => {
      const base = baseSidewalk();
      const patch = dataset(
        "guide-branch",
        [
          { id: 101, lon: 0, lat: 0.000004, tags: { name: "Survey marker" } },
          { id: 102, lon: 0.001, lat: 0.000004 },
          { id: 103, lon: 0.002, lat: 0.000004 },
        ],
        [
          { id: 20, refs: [101, 102], tags: { highway: "footway", name: "Survey sidewalk" } },
          { id: 30, refs: [102, 103], tags: { highway: "footway" } },
        ],
      );
      const copy = action !== "connect";
      const connect = action !== "copy";
      const remove = action === "copy-connect-remove";
      const decisions: OsmConflationDecision[] = [
        {
          candidateId: "way:20->10",
          action: "accept",
          transferProperties: copy,
          attachNetwork: false,
          removeWay: remove,
        },
        {
          candidateId: "node:102->2",
          action: "accept",
          transferProperties: false,
          attachNetwork: connect,
        },
      ];
      const generated = generateConflationArtifacts(
        base,
        patch,
        {
          directMerge: true,
          conflation: {
            propertyKeys: ["name"],
            attachNetwork: true,
            allowWayRemoval: true,
            automatic: "none",
          },
        },
        decisions,
      );
      const result = generated.result;
      expect([...result.ways.sorted()]).toEqual([
        {
          id: 10,
          refs: [1, 2],
          tags: { highway: "footway", name: copy ? "Survey sidewalk" : "Base sidewalk" },
        },
        ...(remove
          ? []
          : [
              {
                id: 20,
                refs: connect ? [101, 2] : [101, 102],
                tags: { highway: "footway", name: "Survey sidewalk" },
              },
            ]),
        { id: 30, refs: connect ? [2, 103] : [102, 103], tags: { highway: "footway" } },
      ]);
      // 101 is tagged; 102 was already orphaned by attachment before removal.
      expect([...result.nodes.sorted()]).toEqual([...base.nodes.sorted(), ...patch.nodes.sorted()]);
      if (remove) {
        expect(
          generated.outcome.features.find((feature) => feature.sourceId === 20)?.wayRemoval,
        ).toMatchObject({ orphanNodeIds: [], retainedTaggedNodeIds: [101] });
      }
      await expectEntityRoundTrip(result);
    },
  );
});
