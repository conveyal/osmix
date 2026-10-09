import { describe, expect, it } from "vitest";

import {
  applyPlan,
  fromPbf,
  merge,
  type MergePlanOptions,
  Osm,
  type PlanDecision,
  planMerge,
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
    const plan = (options: MergePlanOptions) => planMerge(base, patch, options, () => {});

    // Direct changes only: every patch entity is added beside the base.
    const direct = applyPlan(plan({ mergeIdenticalPoints: false, createIntersections: false })).osm;
    expect(entities(direct)).toEqual({
      nodes: [...originalBase.nodes, ...originalPatch.nodes],
      ways: [...originalBase.ways, ...originalPatch.ways],
      relations: [],
    });

    // Identity: 101 and 102 sit on 1 and 2, so they merge, and way 20 becomes way 10.
    const identityPlan = plan({ createIntersections: false });
    expect(
      [...identityPlan.proposals.values()]
        .filter((proposal) => proposal.kind === "exact-merge" || proposal.kind === "way-reconcile")
        .map(({ id, effect }) => [id, effect]),
    ).toEqual([
      ["exact:n101>n1", "applied"],
      ["exact:n102>n2", "applied"],
      ["reconcile:w20>w10", "applied"],
    ]);
    const exact = applyPlan(identityPlan).osm;
    expect([...exact.nodes.sorted()].map((node) => node.id)).toEqual([1, 2, 201, 301, 302]);
    // Way 10 takes the survey's name: an imported way's values win a reconcile (MP-X2).
    expect([...exact.ways.sorted()]).toEqual([
      { ...originalBase.ways[0], tags: { highway: "footway", name: "Survey sidewalk" } },
      originalPatch.ways[1],
    ]);

    // Matching copies 201's tag onto 1; 201 itself stays.
    const conflation = { propertyKeys: ["tactile_paving"], attachNetwork: false };
    const matchingPlan = plan({ createIntersections: false, matching: conflation });
    const matching = applyPlan(matchingPlan).osm;
    expect(matching.nodes.getById(1)).toEqual({
      id: 1,
      lon: 0,
      lat: 0,
      tags: { tactile_paving: "yes" },
    });
    expect([...matching.ways.sorted()]).toEqual([...exact.ways.sorted()]);
    expect(matching.nodes.getById(201)).toEqual(patch.nodes.getById(201));
    expect(
      matchingPlan.matching?.outcome.features.find((feature) => feature.sourceId === 201),
    ).toMatchObject({ copiedKeys: ["tactile_paving"] });

    // Crossings: way 30 crosses way 10 at a new node, a new entity with a negative ID.
    const final = await merge(base, patch, { matching: conflation }, () => {});
    expect(final.nodes.getById(-1)).toEqual({
      id: -1,
      lon: 0.00075,
      lat: 0,
      tags: { crossing: "yes" },
    });
    expect([...final.nodes.sorted()]).toEqual([
      final.nodes.getById(-1),
      ...matching.nodes.sorted(),
    ]);
    expect([...final.ways.sorted()]).toEqual([
      { id: 10, refs: [1, -1, 2], tags: { highway: "footway", name: "Survey sidewalk" } },
      { id: 30, refs: [301, -1, 302], tags: { highway: "footway", name: "New link" } },
    ]);
    expect(entities(base)).toEqual(originalBase);
    expect(entities(patch)).toEqual(originalPatch);
    await expectEntityRoundTrip(final);
  });

  it("MP-E2 keeps new patch IDs clear of the base and applies positive IDs as whole edits", async () => {
    const base = dataset("first-file", [
      { id: -1, lon: 0, lat: 0, tags: { name: "Old entrance", wheelchair: "yes" } },
      { id: -2, lon: 0.001, lat: 0, tags: { name: "Keep me" } },
      { id: 7, lon: 0.001, lat: 0.001, tags: { name: "Main", wheelchair: "yes" } },
    ]);
    const patch = dataset("independent-file", [
      { id: -1, lon: 0.002, lat: 0, tags: { name: "Different entrance" } },
      { id: 7, lon: 0.001, lat: 0.001, tags: { name: "Main entrance" } },
    ]);
    const result = await merge(base, patch, {}, () => {});
    expect([...result.nodes.sorted()]).toEqual([
      // Patch node -1 is new: it moves below the base's lowest ID instead of replacing -1.
      { ...patch.nodes.getById(-1), id: -3 },
      base.nodes.getById(-2),
      base.nodes.getById(-1),
      // Patch node 7 edits base node 7: the whole entity, not a union of tags.
      patch.nodes.getById(7),
    ]);
    expect(base.nodes.getById(7)?.tags).toHaveProperty("wheelchair", "yes");
    // Negative IDs survive export unchanged.
    await expectEntityRoundTrip(result);
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
      const decisions: PlanDecision[] = [
        { proposalId: "copy:w20>w10", action: copy ? "accept" : "reject" },
        { proposalId: "connect:n102>n2", action: connect ? "accept" : "reject" },
        ...(remove ? [{ proposalId: "remove:w20>w10", action: "accept" as const }] : []),
      ];
      const generated = planMerge(
        base,
        patch,
        {
          mergeIdenticalPoints: false,
          createIntersections: false,
          matching: {
            propertyKeys: ["name"],
            attachNetwork: true,
            allowWayRemoval: true,
            automatic: "none",
          },
          decisions,
        },
        () => {},
      );
      const result = applyPlan(generated).osm;
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
      // 101 is tagged, so it stays; the connection drops untagged 102, which it left unused.
      expect([...result.nodes.sorted()]).toEqual([
        ...base.nodes.sorted(),
        ...patch.nodes.sorted().filter((node) => !connect || node.id !== 102),
      ]);
      if (remove) {
        expect(
          generated.matching?.outcome.features.find((feature) => feature.sourceId === 20)
            ?.wayRemoval,
        ).toMatchObject({ orphanNodeIds: [], retainedTaggedNodeIds: [101] });
      }
      await expectEntityRoundTrip(result);
    },
  );
});
