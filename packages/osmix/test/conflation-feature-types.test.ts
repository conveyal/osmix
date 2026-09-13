import { describe, expect, it } from "vitest";

import {
  applyChangesetToOsm,
  discoverConflationCandidates,
  generateConflationChangeset,
  merge,
  Osm,
  type OsmConflationCandidate,
  type OsmConflationDecision,
  type OsmConflationFeatureTypeConflict,
  type OsmConflationOptions,
  OsmixWorker,
  resolveConflationActions,
} from "../src/index";

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
  expect(resolveConflationActions(candidate, accept)).toEqual({
    transferProperties: false,
    attachNetwork: false,
  });
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

      const generated = generateConflationChangeset(
        base,
        patch,
        { directMerge: true, conflation: options },
        [accept],
        discovery,
      );
      expect(generated.nodeChanges[1]).toBeUndefined();
      expectOrdinaryAddition(applyChangesetToOsm(generated), base, patch);
    },
  );

  it("keeps the school as an ordinary import in the public merge despite explicit acceptance", async () => {
    const { base, patch } = inputs();
    const result = await merge(base, patch, {
      directMerge: true,
      conflation: { ...options, decisions: [accept] },
    });
    expectOrdinaryAddition(result, base, patch);
  });

  it("keeps worker evidence detached and blocks filtered bulk and individual acceptance", () => {
    const { base, patch } = inputs({ relation: true });
    const worker = new TestWorker();
    worker.add(base);
    worker.add(patch);
    worker.discoverConflation(base.id, patch.id, options);
    worker.setConflationFilter(base.id, { sourceId: 101 });
    const page = worker.getConflationPage(base.id, 0, 1);
    const candidate = requireCandidate(page.candidates);
    expectConflict(candidate);
    const conflicts = candidate.evidence.featureTypeConflicts;
    if (!conflicts?.[0]) throw Error("Expected explicit conflicting feature classifications");
    conflicts[0].baseValue = "school";
    conflicts.splice(0, conflicts.length);
    expectConflict(requireCandidate(worker.getConflationPage(base.id, 0, 1).candidates));

    worker.setConflationDecision(base.id, accept);
    worker.setConflationFilter(base.id, { sourceId: 101, status: "accepted" });
    expect(worker.getConflationPage(base.id, 0, 1).totalCandidates).toBe(0);
    worker.setConflationFilter(base.id, {
      sourceId: 101,
      status: "blocked",
      reason: "feature-type-conflict",
    });
    const blocked = worker.getConflationPage(base.id, 0, 1);
    expect(blocked.totalCandidates).toBe(1);
    expectConflict(requireCandidate(blocked.candidates));
    expect(worker.getConflationSummary(base.id).blocked).toBe(1);
    for (const action of ["transfer-properties", "attach-network"] as const) {
      expect(blocked.bulkActions[action]).toMatchObject({
        filteredCandidates: 1,
        eligibleCandidates: 0,
        changedCandidates: 0,
        skippedCandidates: 1,
      });
      const bulk = worker.applyConflationBulkDecision(base.id, {
        action,
        filter: { sourceId: 101, reason: "feature-type-conflict" },
      });
      expect(bulk.preview).toMatchObject({
        filteredCandidates: 1,
        eligibleCandidates: 0,
        changedCandidates: 0,
        skippedCandidates: 1,
      });
      expect(bulk.decisions).toEqual([accept]);
    }
    const generated = worker.generateConflationChangeset(base.id, { directMerge: true });
    expect(generated.outcome.summary).toMatchObject({
      tagCopyActions: 0,
      copiedTagValues: 0,
      networkAttachmentActions: 0,
    });
    const preview = worker.getChangesetPage(base.id, 0, 100);
    expect(
      preview.changes?.some((change) => change.changeType === "modify" && change.entity.id === 1),
    ).toBe(false);
    worker.applyChangesAndReplace(base.id);
    expectOrdinaryAddition(worker.getOsm(base.id), base, patch);
  });

  it("blocks attachment-only school/cafe matches at aligned footway endpoints", () => {
    const { base, patch } = inputs();
    const attachmentOnly = { propertyKeys: [], attachNetwork: true };
    const worker = new TestWorker();
    worker.add(base);
    worker.add(patch);
    worker.discoverConflation(base.id, patch.id, attachmentOnly);
    worker.setConflationFilter(base.id, { sourceId: 101 });
    const candidate = requireCandidate(worker.getConflationPage(base.id, 0, 1).candidates);
    expect(candidate.evidence.tagDiff).toEqual([]);
    expect(candidate.networkAttachment).toMatchObject({
      status: "blocked",
      reasons: expect.arrayContaining(["feature-type-conflict"]),
    });
    expect(candidate.evidence).toMatchObject({ featureTypeConflicts: [featureTypeConflict] });
    worker.setConflationDecision(base.id, { ...accept, transferProperties: false });
    worker.generateConflationChangeset(base.id, { directMerge: true });
    worker.applyChangesAndReplace(base.id);
    expectOrdinaryAddition(worker.getOsm(base.id), base, patch);
  });

  it.each([
    { name: "matching explicit types", baseAmenity: "cafe", patchAmenity: "cafe" },
    { name: "missing base classification", baseAmenity: null, patchAmenity: "school" },
    { name: "missing imported classification", baseAmenity: "cafe", patchAmenity: null },
  ])("allows $name subject to the other matching checks", ({ baseAmenity, patchAmenity }) => {
    const { base, patch } = inputs({ baseAmenity, patchAmenity });
    const discovery = discoverConflationCandidates(base, patch, options);
    const candidate = requireCandidate(discovery.candidates);
    expect(candidate.reasons).not.toContain("feature-type-conflict");
    expect(candidate.evidence.featureTypeConflicts ?? []).toEqual([]);
    expect(resolveConflationActions(candidate)).toEqual({
      transferProperties: true,
      attachNetwork: true,
    });
    const generated = generateConflationChangeset(
      base,
      patch,
      { directMerge: true, conflation: options },
      [],
      discovery,
    );
    const result = applyChangesetToOsm(generated);
    expect(result.nodes.getById(1)?.tags?.["name"]).toBe("Imported school");
    expect(result.nodes.getById(1)?.tags?.["amenity"]).toBe(baseAmenity ?? undefined);
    expect(result.nodes.getById(101)).toEqual(patch.nodes.getById(101));
    expect(result.ways.getById(10)).toEqual(base.ways.getById(10));
    expect(result.ways.getById(20)?.refs).toEqual([1, 102]);
  });

  it("preserves authoritative same-ID updates even when feature classification changes", async () => {
    const { base, patch } = inputs({ sameId: true });
    const result = await merge(base, patch, { directMerge: true, conflation: options });
    expect(result.nodes.getById(1)).toEqual(patch.nodes.getById(1));
    expect(result.nodes.getById(1)?.tags?.["amenity"]).toBe("school");
    expect(result.ways.getById(10)).toEqual(base.ways.getById(10));
    expect(result.ways.getById(20)).toEqual(patch.ways.getById(20));
  });
});
