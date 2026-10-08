import { Osm } from "@osmix/core";
import type { OsmNode, OsmRelation, OsmWay } from "@osmix/types";
import { describe, expect, it } from "vitest";

import { merge } from "../src/merge.ts";
import { PlanOverlay } from "../src/plan/overlay.ts";
import { applyPlan, generateMergePlanOsc, planMerge } from "../src/plan/plan.ts";
import { demoteDrivableConnections } from "../src/plan/validate.ts";
import type { OsmConflationCandidate, OsmConflationDiscovery } from "../src/types.ts";

const quiet = () => {};

function dataset(id: string, nodes: OsmNode[], ways: OsmWay[] = [], relations: OsmRelation[] = []) {
  const osm = new Osm({ id });
  for (const node of nodes) osm.nodes.addNode(node);
  for (const way of ways) osm.ways.addWay(way);
  for (const relation of relations) osm.relations.addRelation(relation);
  osm.buildIndexes();
  osm.buildSpatialIndexes();
  return osm;
}

function baseRoad() {
  return dataset(
    "base",
    [
      { id: 1, lon: 0, lat: 0 },
      { id: 2, lon: 0.001, lat: 0 },
    ],
    [{ id: 10, refs: [1, 2], tags: { highway: "residential" } }],
  );
}

/** An import numbered from -1, with one edit of base node 2. */
function importedPath() {
  return dataset(
    "patch",
    [
      { id: -1, lon: 0, lat: 0.001 },
      { id: -2, lon: 0.001, lat: 0.001 },
      { id: -3, lon: 0.002, lat: 0.002, tags: { amenity: "bench" } },
      { id: 2, lon: 0.001, lat: 0, tags: { crossing: "marked" } },
    ],
    [{ id: -1, refs: [-1, -2, 2], tags: { highway: "footway" } }],
    [{ id: -1, members: [{ type: "way", ref: -1, role: "" }], tags: { type: "route" } }],
  );
}

describe("planMerge", () => {
  it("applies to the same dataset as a direct merge with exact reconciliation", async () => {
    const base = baseRoad();
    const patch = importedPath();
    const expected = await merge(base, patch, { createIntersections: false }, quiet);
    const { osm } = applyPlan(planMerge(base, patch, {}, quiet));
    expect(osm.contentHash()).toBe(expected.contentHash());
  });

  it("groups the patch into features with stable proposal IDs", () => {
    const plan = planMerge(baseRoad(), importedPath(), {}, quiet);
    expect(
      plan.features.map(({ key, outcome, proposalIds, vertexIds }) => ({
        key,
        outcome,
        proposalIds,
        vertexIds,
      })),
    ).toEqual([
      {
        key: "way:-1",
        outcome: "replaced",
        proposalIds: ["add:w-1", "replace:n2"],
        vertexIds: [-1, -2, 2],
      },
      { key: "node:-3", outcome: "added", proposalIds: ["add:n-3"], vertexIds: undefined },
      { key: "relation:-1", outcome: "added", proposalIds: ["add:r-1"], vertexIds: undefined },
    ]);
    expect(plan.summary.replacesBase).toBe(1);
    expect(plan.summary.features).toMatchObject({ replaced: 1, added: 2, unchanged: 0 });
    expect(plan.idRemap).toEqual({ mode: "osm", remapped: 0 });
    expect(plan.staleDecisions).toEqual([]);
  });

  it("moves negative patch IDs below the base's lowest ID so imports never collide", () => {
    // The base already holds an earlier import numbered from -1.
    const base = dataset(
      "base",
      [
        { id: -2, lon: 1, lat: 1 },
        { id: -1, lon: 1.001, lat: 1 },
      ],
      [{ id: -1, refs: [-2, -1], tags: { highway: "footway", name: "Earlier import" } }],
    );
    const patch = importedPath();
    const plan = planMerge(base, patch, {}, quiet);
    const { osm } = applyPlan(plan);
    expect(osm.ways.getById(-1)?.tags?.["name"]).toBe("Earlier import");
    expect(osm.ways.getById(-2)?.refs).toEqual([-3, -4, 2]);
    expect(osm.relations.getById(-1)?.members).toEqual([{ type: "way", ref: -2, role: "" }]);
    expect(plan.features[0]).toMatchObject({ key: "way:-1", originalId: -1, id: -2 });
    // Three nodes and the way; the base has no relations, so relation -1 keeps its ID.
    expect(plan.idRemap).toEqual({ mode: "osm", remapped: 4 });
  });

  it("reads every patch ID as new when asked, so positive IDs replace nothing", () => {
    const base = baseRoad();
    // Identical points stay separate here so the edit of node 2 is plainly a new node.
    const plan = planMerge(
      base,
      importedPath(),
      { patchIds: "new", mergeIdenticalPoints: false },
      quiet,
    );
    const { osm } = applyPlan(plan);
    expect(plan.summary.replacesBase).toBe(0);
    expect(osm.nodes.getById(2)?.tags).toBeUndefined();
    expect(osm.nodes.size).toBe(base.nodes.size + 4);
    // Patch node 2, now new, sits exactly on base node 2: a merge to decide, not an edit.
    expect(plan.features[0]).toMatchObject({
      outcome: "needs-decision",
      proposalIds: ["add:w-1", "exact:n2>n2"],
    });
  });

  it("writes the plan as osmChange without applying it", () => {
    const osc = generateMergePlanOsc(planMerge(baseRoad(), importedPath(), {}, quiet));
    expect(osc).toContain('<way id="-1"');
    expect(osc).toMatch(/<modify>.*<node id="2"/s);
  });

  it("refuses inputs without built indexes", () => {
    const unindexed = new Osm({ id: "unindexed" });
    expect(() => planMerge(unindexed, importedPath(), {}, quiet)).toThrow(
      "Build indexes for unindexed before planning a merge",
    );
  });
});

/** An imported sidewalk that starts at base node 1 and duplicates base way 10 exactly. */
function importedDuplicate() {
  return dataset(
    "patch",
    [
      { id: -1, lon: 0, lat: 0 },
      { id: -2, lon: 0.001, lat: 0 },
      { id: -3, lon: 0, lat: 0.001 },
    ],
    [
      { id: -1, refs: [-1, -2], tags: { highway: "residential", name: "Main" } },
      { id: -2, refs: [-1, -3], tags: { highway: "footway" } },
    ],
  );
}

describe("identity proposals", () => {
  it("lets imported values win an identical-point merge, and waits on a grade change", () => {
    const base = dataset("base", [{ id: 1, lon: 0, lat: 0, tags: { kerb: "raised" } }]);
    const kerb = dataset("patch", [
      { id: -1, lon: 0, lat: 0, tags: { kerb: "lowered", barrier: "kerb" } },
    ]);
    const merged = planMerge(base, kerb, {}, quiet);
    expect(merged.proposals.get("exact:n-1>n1")).toMatchObject({ status: "automatic" });
    expect(applyPlan(merged).osm.nodes.getById(1)?.tags).toEqual({
      kerb: "lowered",
      barrier: "kerb",
    });

    const upstairs = dataset("patch", [{ id: -1, lon: 0, lat: 0, tags: { level: "1" } }]);
    const waiting = planMerge(base, upstairs, {}, quiet);
    expect(waiting.proposals.get("exact:n-1>n1")).toMatchObject({
      status: "review",
      reasons: ["grade-change"],
      effect: "needs-decision",
    });
    expect(applyPlan(waiting).osm.nodes.getById(1)?.tags).toEqual({ kerb: "raised" });
    const accepted = planMerge(
      base,
      upstairs,
      { decisions: [{ proposalId: "exact:n-1>n1", action: "accept" }] },
      quiet,
    );
    expect(applyPlan(accepted).osm.nodes.getById(1)?.tags).toEqual({
      kerb: "raised",
      level: "1",
    });
  });

  it("merges identical points and the way they make identical automatically", () => {
    const plan = planMerge(baseRoad(), importedDuplicate(), {}, quiet);
    expect([...plan.proposals.values()].map(({ id, effect }) => [id, effect])).toEqual([
      ["add:w-1", "skipped"],
      ["add:w-2", "applied"],
      ["exact:n-1>n1", "applied"],
      ["exact:n-2>n2", "applied"],
      ["reconcile:w-1>w10", "applied"],
    ]);
    // A shared vertex belongs to the first way that uses it.
    expect(plan.features.map(({ key, outcome }) => [key, outcome])).toEqual([
      ["way:-1", "merged"],
      ["way:-2", "added"],
    ]);
    const { osm } = applyPlan(plan);
    expect(osm.ways.getById(10)?.tags).toEqual({ highway: "residential", name: "Main" });
    expect(osm.ways.getById(-2)?.refs).toEqual([1, -3]);
  });

  it("waits for decisions when identical points are not merged automatically", () => {
    const base = baseRoad();
    const patch = importedDuplicate();
    const review = planMerge(base, patch, { mergeIdenticalPoints: false }, quiet);
    expect(review.proposals.get("exact:n-1>n1")).toMatchObject({
      status: "review",
      effect: "needs-decision",
    });
    // The way cannot match until its points merge.
    expect(review.proposals.has("reconcile:w-1>w10")).toBe(false);
    expect(review.summary.features["needs-decision"]).toBe(1);
    expect(applyPlan(review).osm.ways.getById(-2)?.refs).toEqual([-1, -3]);

    const decided = planMerge(
      base,
      patch,
      {
        mergeIdenticalPoints: false,
        decisions: [
          { proposalId: "exact:n-1>n1", action: "accept" },
          { proposalId: "exact:n-2>n2", action: "reject" },
          { proposalId: "reconcile:w-1>w10", action: "accept" },
        ],
      },
      quiet,
    );
    expect(decided.proposals.get("exact:n-1>n1")?.effect).toBe("applied");
    expect(decided.proposals.get("exact:n-2>n2")?.effect).toBe("skipped");
    // Rejecting the second point keeps the ways different, so that decision has no proposal.
    expect(decided.staleDecisions).toEqual(["reconcile:w-1>w10"]);
    const { osm } = applyPlan(decided);
    expect(osm.ways.getById(-2)?.refs).toEqual([1, -3]);
    expect(osm.ways.getById(-1)?.refs).toEqual([1, -2]);
  });

  it("keeps a rejected automatic merge separate", () => {
    const plan = planMerge(
      baseRoad(),
      importedDuplicate(),
      { decisions: [{ proposalId: "exact:n-1>n1", action: "reject" }] },
      quiet,
    );
    expect(plan.proposals.get("exact:n-1>n1")).toMatchObject({
      status: "automatic",
      decision: "reject",
      effect: "skipped",
    });
    expect(applyPlan(plan).osm.nodes.getById(-1)).toMatchObject({ lon: 0, lat: 0 });
  });
});

describe("crossing proposals", () => {
  function crossingInputs() {
    const base = dataset(
      "base",
      [
        { id: 1, lon: 0, lat: 0 },
        { id: 2, lon: 0.002, lat: 0 },
      ],
      [{ id: 10, refs: [1, 2], tags: { highway: "residential" } }],
    );
    const patch = dataset(
      "patch",
      [
        { id: -1, lon: 0.001, lat: -0.001 },
        { id: -2, lon: 0.001, lat: 0.001 },
      ],
      [{ id: -1, refs: [-1, -2], tags: { highway: "footway" } }],
    );
    return { base, patch };
  }

  it("connects an imported path to the road it crosses with a new node", () => {
    const { base, patch } = crossingInputs();
    const plan = planMerge(base, patch, {}, quiet);
    const id = "xnode:w-1|w10@0.0010000,0.0000000";
    expect(plan.proposals.get(id)).toMatchObject({ kind: "crossing-node", effect: "applied" });
    expect(plan.features[0]).toMatchObject({ key: "way:-1", outcome: "connected" });
    const { osm } = applyPlan(plan);
    const [, crossing] = osm.ways.getById(10)!.refs;
    expect(osm.ways.getById(-1)?.refs).toEqual([-1, crossing, -2]);
    expect(osm.nodes.getById(crossing!)).toMatchObject({ lon: 0.001, lat: 0 });
  });

  it("leaves a rejected crossing unconnected", () => {
    const { base, patch } = crossingInputs();
    const plan = planMerge(
      base,
      patch,
      { decisions: [{ proposalId: "xnode:w-1|w10@0.0010000,0.0000000", action: "reject" }] },
      quiet,
    );
    const { osm } = applyPlan(plan);
    expect(osm.ways.getById(10)?.refs).toEqual([1, 2]);
    expect(osm.ways.getById(-1)?.refs).toEqual([-1, -2]);
  });
  it("snaps a crossing that changes grade only after a decision, under one proposal", () => {
    const base = dataset(
      "base",
      [
        { id: 1, lon: 0, lat: 0 },
        { id: 3, lon: 0.0005, lat: 0 },
        { id: 2, lon: 0.001, lat: 0 },
      ],
      [{ id: 10, refs: [1, 3, 2], tags: { highway: "footway" } }],
    );
    // The imported vertex sits on the base way, so both segments beside it report the crossing,
    // just either side of zero latitude.
    const patch = dataset(
      "patch",
      [
        { id: -1, lon: 0.0005, lat: -0.001 },
        { id: -2, lon: 0.0005, lat: 0.000002, tags: { level: "1" } },
        { id: -3, lon: 0.0005, lat: 0.001 },
      ],
      [{ id: -1, refs: [-1, -2, -3], tags: { highway: "footway" } }],
    );
    const plan = planMerge(base, patch, {}, quiet);
    const snaps = [...plan.proposals.values()].filter(({ kind }) => kind === "crossing-snap");
    expect(snaps).toEqual([
      expect.objectContaining({
        id: "xsnap:w-1|w10@0.0005000,0.0000000",
        status: "review",
        reasons: ["grade-change"],
        effect: "needs-decision",
      }),
    ]);
    expect(applyPlan(plan).osm.ways.getById(-1)?.refs).toEqual([-1, -2, -3]);
  });

  it("proposes one crossing where a base way passes through an imported vertex", () => {
    // From the eastern Washington sidewalk import: the base footway passes within 1e-7° of
    // imported vertex 3864880, so both imported segments beside it report the same crossing.
    const base = dataset(
      "base",
      [
        { id: -2633087, lon: -119.3678777, lat: 46.2984253 },
        { id: -2633088, lon: -119.3678903, lat: 46.298442 },
        { id: -2633089, lon: -119.3679106, lat: 46.298456 },
      ],
      [{ id: -217907, refs: [-2633087, -2633088, -2633089], tags: { highway: "footway" } }],
    );
    const patch = dataset(
      "patch",
      [
        { id: 3864890, lon: -119.3679, lat: 46.2984489 },
        { id: 3864892, lon: -119.3678929, lat: 46.2984437 },
        { id: 3864880, lon: -119.3678872, lat: 46.2984379 },
        { id: 3864881, lon: -119.3678765, lat: 46.2984179 },
      ],
      [
        {
          id: 1899848,
          refs: [3864890, 3864892, 3864880, 3864881],
          tags: { highway: "footway", footway: "sidewalk" },
        },
      ],
    );
    const plan = planMerge(
      base,
      patch,
      { matching: { propertyKeys: ["kerb"], attachNetwork: true, automatic: "none" } },
      quiet,
    );
    const crossings = [...plan.proposals.values()].filter(({ id }) =>
      id.includes("@-119.3678872,"),
    );
    expect(crossings).toHaveLength(1);
    expect(() => applyPlan(plan)).not.toThrow();
  });
});

describe("plan diagnostics", () => {
  it("measures routing topology before and after without building", () => {
    const base = dataset(
      "base",
      [
        { id: 1, lon: 0, lat: 0 },
        { id: 2, lon: 0.002, lat: 0 },
      ],
      [{ id: 10, refs: [1, 2], tags: { highway: "residential" } }],
    );
    const patch = dataset(
      "patch",
      [
        { id: -1, lon: 0.001, lat: -0.001 },
        { id: -2, lon: 0.001, lat: 0.001 },
      ],
      [{ id: -1, refs: [-1, -2], tags: { highway: "footway" } }],
    );
    const { car, walk } = planMerge(base, patch, {}, quiet).diagnostics.routing;
    // The crossing splits the road; the footway joins the walk network only.
    expect(car.delta).toEqual({ nodes: 3, routableNodes: 1, edges: 2, components: 0 });
    expect(walk.delta).toEqual({ nodes: 3, routableNodes: 3, edges: 6, components: 0 });
  });

  it("reports new routing-integrity problems and refuses to apply them", () => {
    const base = baseRoad();
    const patch = new Osm({ id: "patch" });
    patch.nodes.addNode({ id: -1, lon: 0, lat: 0.001 });
    patch.ways.addWay({ id: -1, refs: [-1, -99], tags: { highway: "footway" } });
    patch.buildIndexes();
    patch.buildSpatialIndexes();
    const plan = planMerge(base, patch, {}, quiet);
    expect(plan.diagnostics.integrity).toEqual([
      { description: "way -1 references missing node -99", entities: [{ type: "way", id: -1 }] },
    ]);
    expect(() => applyPlan(plan)).toThrow(
      "Merge introduced routing-integrity problems: way -1 references missing node -99",
    );
  });

  it("moves an automatic connection that rewrites a drivable imported way to review", () => {
    const base = baseRoad();
    const overlay = new PlanOverlay(base);
    overlay.create({ id: -1, lon: 0, lat: 0.000004 }, "patch");
    overlay.create({ id: -2, lon: 0, lat: 0.001 }, "patch");
    overlay.create({ id: -5, refs: [-1, -2], tags: { highway: "service" } }, "patch");
    const candidate: OsmConflationCandidate = {
      id: "node:-1->1",
      entityType: "node",
      sourceId: -1,
      targetId: 1,
      status: "automatic",
      reasons: [],
      propertyTransfer: { status: "blocked", reasons: ["no-transferable-properties"] },
      networkAttachment: { status: "automatic", reasons: [] },
      evidence: {
        distanceMeters: 0.45,
        sourceRoutingFamilies: [],
        targetRoutingFamilies: [],
        tagDiff: [],
        patchWayIds: [-5],
      },
    };
    const discovery = { candidates: [candidate] } as unknown as OsmConflationDiscovery;
    expect(demoteDrivableConnections(discovery, overlay)).toEqual([candidate]);
    expect(candidate).toMatchObject({
      status: "review",
      networkAttachment: { status: "review", reasons: ["drivable-network"] },
    });
  });
});
