import { describe, expect, it } from "vitest";

import {
  applyPlan,
  discoverConflationCandidates,
  type MergePlanOptions,
  merge,
  Osm,
  type OsmConflationCandidate,
  type OsmConflationDecision,
  type OsmConflationFeatureTypeConflict,
  type OsmConflationOptions,
  OsmixWorker,
  planMerge,
  type PlanProposal,
  setMergePlanDecisions,
} from "../src/index";
import { withMatchingDecisions } from "./plan-decisions.ts";

const candidateId = "node:101->1";
const featureTypeConflict: OsmConflationFeatureTypeConflict = {
  key: "amenity",
  baseValue: "cafe",
  patchValue: "school",
};
const accept: OsmConflationDecision = {
  candidateId,
  action: "accept",
  transferProperties: true,
  attachNetwork: true,
};
const options: OsmConflationOptions = { propertyKeys: ["name"], attachNetwork: true };
const direct: MergePlanOptions = { mergeIdenticalPoints: false, createIntersections: false };
const planOptions: MergePlanOptions = { ...direct, matching: options };
const connectId = "connect:n101>n1";
const copyId = "copy:n101>n1";
const acceptBoth = [
  { proposalId: copyId, action: "accept" as const },
  { proposalId: connectId, action: "accept" as const },
];

function inputs({
  baseAmenity = "cafe",
  patchAmenity = "school",
  relation = false,
  sameId = false,
}: {
  baseAmenity?: string | null;
  patchAmenity?: string | null;
  relation?: boolean;
  sameId?: boolean;
} = {}) {
  const base = new Osm({ id: "feature-types-base" });
  base.nodes.addNode({
    id: 1,
    lon: 0,
    lat: 0,
    tags: { name: "Base cafe", ...(baseAmenity ? { amenity: baseAmenity } : {}) },
  });
  base.nodes.addNode({ id: 2, lon: -0.001, lat: 0 });
  base.nodes.buildIndex();
  base.ways.addWay({ id: 10, refs: [2, 1], tags: { highway: "footway" } });
  base.buildIndexes();
  base.buildSpatialIndexes();
  const patch = new Osm({ id: "feature-types-import" });
  const sourceId = sameId ? 1 : 101;
  patch.nodes.addNode({
    id: sourceId,
    lon: 0.000005,
    lat: 0,
    tags: { name: "Imported school", ...(patchAmenity ? { amenity: patchAmenity } : {}) },
  });
  patch.nodes.addNode({ id: 102, lon: 0.001, lat: 0 });
  patch.nodes.buildIndex();
  patch.ways.addWay({ id: 20, refs: [sourceId, 102], tags: { highway: "footway" } });
  if (relation)
    patch.relations.addRelation({
      id: 30,
      members: [{ type: "node", ref: sourceId, role: "" }],
      tags: { type: "route", route: "foot" },
    });
  patch.buildIndexes();
  patch.buildSpatialIndexes();
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

function requireCandidate(candidates: readonly OsmConflationCandidate[]) {
  const candidate = candidates.find((row) => row.id === candidateId);
  if (!candidate) throw Error("Expected imported school candidate beside the cafe");
  return candidate;
}

function expectConflict(candidate: OsmConflationCandidate) {
  expect(candidate).toMatchObject({
    status: "blocked",
    reasons: expect.arrayContaining(["feature-type-conflict"]),
    propertyTransfer: {
      status: "blocked",
      reasons: expect.arrayContaining(["feature-type-conflict"]),
    },
    networkAttachment: {
      status: "blocked",
      reasons: expect.arrayContaining(["feature-type-conflict"]),
    },
    evidence: { featureTypeConflicts: [featureTypeConflict] },
  });
}

/** Both entrance proposals are blocked for a feature-type conflict, whatever was decided. */
function expectBlockedProposals(proposals: Iterable<PlanProposal>) {
  const byId = new Map([...proposals].map((proposal) => [proposal.id, proposal]));
  for (const id of [copyId, connectId]) {
    expect(byId.get(id)).toMatchObject({
      status: "blocked",
      effect: "blocked",
      reasons: expect.arrayContaining(["feature-type-conflict"]),
    });
  }
}

function expectOrdinaryAddition(result: Osm, base: Osm, patch: Osm) {
  expect([...result.nodes.sorted()]).toEqual([...base.nodes.sorted(), ...patch.nodes.sorted()]);
  expect([...result.ways.sorted()]).toEqual([...base.ways.sorted(), ...patch.ways.sorted()]);
  expect([...result.relations.sorted()]).toEqual([
    ...base.relations.sorted(),
    ...patch.relations.sorted(),
  ]);
  expect(result.nodes.getById(1)?.tags).toEqual({ name: "Base cafe", amenity: "cafe" });
  expect(result.ways.getById(20)?.refs).toEqual([101, 102]);
}

describe("feature classification conflicts through the public facade and worker", () => {
  it.each([false, true])(
    "blocks school/cafe matching independently of selected copy keys (relation=%s)",
    (relation) => {
      const { base, patch } = inputs({ relation });
      const discovery = discoverConflationCandidates(base, patch, options);
      const candidate = requireCandidate(discovery.candidates);
      expectConflict(candidate);
      expect(candidate.evidence.tagDiff.map((diff) => diff.key)).toEqual(["name"]);
      if (relation) expect(candidate.reasons).toContain("relation-member");

      const plan = planMerge(base, patch, planOptions, () => {});
      setMergePlanDecisions(plan, acceptBoth);
      expectBlockedProposals(plan.proposals.values());
      expectOrdinaryAddition(applyPlan(plan).osm, base, patch);
    },
  );

  it("keeps the school as an ordinary import in the public merge despite explicit acceptance", async () => {
    const { base, patch } = inputs();
    const result = await merge(
      base,
      patch,
      withMatchingDecisions(base, patch, planOptions, [accept]),
    );
    expectOrdinaryAddition(result, base, patch);
  });

  it("keeps worker evidence detached and blocks filtered bulk and individual acceptance", () => {
    const { base, patch } = inputs({ relation: true });
    const worker = new TestWorker();
    worker.add(base);
    worker.add(patch);
    worker.planMerge(base.id, patch.id, planOptions);
    const detail = worker.getMergePlanFeature(base.id, "way:20");
    const candidate = detail.candidates[copyId];
    if (!candidate) throw Error("Expected imported school candidate beside the cafe");
    expectConflict(candidate);
    const conflicts = candidate.evidence.featureTypeConflicts;
    if (!conflicts?.[0]) throw Error("Expected explicit conflicting feature classifications");
    conflicts[0].baseValue = "school";
    conflicts.splice(0, conflicts.length);
    expectConflict(worker.getMergePlanFeature(base.id, "way:20").candidates[copyId]!);

    const decided = worker.setMergePlanDecisions(base.id, acceptBoth);
    expect(decided.matching?.candidates.blocked).toBe(1);
    worker.setMergePlanFilter(base.id, { status: "blocked", reason: "feature-type-conflict" });
    const blocked = worker.getMergePlanPage(base.id, 0, 1);
    expect(blocked.total).toBe(1);
    expectBlockedProposals(blocked.features[0]!.proposals);
    for (const kind of ["copy-tags", "connect"] as const) {
      const bulk = worker.applyMergePlanBulk(base.id, {
        action: "accept",
        filter: { kind, reason: "feature-type-conflict" },
      });
      expect(bulk).toMatchObject({ changed: 0, waiting: 0 });
      expect(bulk.overview.decisions).toEqual(acceptBoth);
    }
    expect(worker.getMergePlanOverview(base.id).matching?.outcome.summary).toMatchObject({
      tagCopyActions: 0,
      copiedTagValues: 0,
      networkAttachmentActions: 0,
    });
    expect(worker.getMergePlanOsc(base.id)).toMatch(/<modify><\/modify>/);
    worker.applyMergePlan(base.id);
    expectOrdinaryAddition(worker.getOsm(base.id), base, patch);
  });

  it("blocks attachment-only school/cafe matches at aligned footway endpoints", () => {
    const { base, patch } = inputs();
    const worker = new TestWorker();
    worker.add(base);
    worker.add(patch);
    worker.planMerge(base.id, patch.id, {
      ...direct,
      matching: { propertyKeys: [], attachNetwork: true },
    });
    const detail = worker.getMergePlanFeature(base.id, "way:20");
    const candidate = detail.candidates[connectId];
    if (!candidate) throw Error("Expected imported school candidate beside the cafe");
    expect(candidate.evidence.tagDiff).toEqual([]);
    expect(candidate.networkAttachment).toMatchObject({
      status: "blocked",
      reasons: expect.arrayContaining(["feature-type-conflict"]),
    });
    expect(candidate.evidence).toMatchObject({ featureTypeConflicts: [featureTypeConflict] });
    worker.setMergePlanDecisions(base.id, [{ proposalId: connectId, action: "accept" }]);
    expect(
      worker
        .getMergePlanPage(base.id, 0, 10)
        .features[0]?.proposals.find(({ id }) => id === connectId),
    ).toMatchObject({ decision: "accept", effect: "blocked" });
    worker.applyMergePlan(base.id);
    expectOrdinaryAddition(worker.getOsm(base.id), base, patch);
  });

  it.each([
    { name: "matching explicit types", baseAmenity: "cafe", patchAmenity: "cafe" },
    { name: "missing base classification", baseAmenity: null, patchAmenity: "school" },
    { name: "missing imported classification", baseAmenity: "cafe", patchAmenity: null },
  ])("allows $name subject to the other matching checks", async ({ baseAmenity, patchAmenity }) => {
    const { base, patch } = inputs({ baseAmenity, patchAmenity });
    const discovery = discoverConflationCandidates(base, patch, options);
    const candidate = requireCandidate(discovery.candidates);
    expect(candidate.reasons).not.toContain("feature-type-conflict");
    expect(candidate.evidence.featureTypeConflicts ?? []).toEqual([]);
    expect(candidate.propertyTransfer.status).toBe("automatic");
    expect(candidate.networkAttachment?.status).toBe("automatic");
    const result = await merge(base, patch, planOptions);
    expect(result.nodes.getById(1)?.tags?.["name"]).toBe("Imported school");
    // The connection merges the imported point's tags too: its values win, base-only ones stay.
    expect(result.nodes.getById(1)?.tags?.["amenity"]).toBe(
      patchAmenity ?? baseAmenity ?? undefined,
    );
    expect(result.nodes.getById(101)).toBeNull();
    expect(result.ways.getById(10)).toEqual(base.ways.getById(10));
    expect(result.ways.getById(20)?.refs).toEqual([1, 102]);
  });

  it("preserves authoritative same-ID updates even when feature classification changes", async () => {
    const { base, patch } = inputs({ sameId: true });
    const result = await merge(base, patch, planOptions);
    expect(result.nodes.getById(1)).toEqual(patch.nodes.getById(1));
    expect(result.nodes.getById(1)?.tags?.["amenity"]).toBe("school");
    expect(result.ways.getById(10)).toEqual(base.ways.getById(10));
    expect(result.ways.getById(20)).toEqual(patch.ways.getById(20));
  });
});
