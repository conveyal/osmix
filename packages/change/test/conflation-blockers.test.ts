import { Osm } from "@osmix/core";
import type { OsmTags } from "@osmix/types";
import { describe, expect, it } from "vitest";

import {
  applyChangesetToOsm,
  buildConflationBulkDecisionResult,
  conflationEffectiveStatus,
  discoverConflationCandidates,
  filterConflationCandidates,
  generateConflationChangeset,
  merge,
  type OsmConflationDecision,
  type OsmConflationOptions,
  summarizeConflationCandidates,
} from "../src/index.ts";

type RelationKind = "none" | "route" | "restriction";
type ConflictKind = "grade" | "access" | "protected" | "geometry" | "none";

function createWayDataset(
  id: string,
  firstNodeId: number,
  wayId: number,
  lat: number,
  tags: OsmTags,
  relation: RelationKind,
  closed: boolean,
  alternative = false,
) {
  const osm = new Osm({ id });
  osm.nodes.addNode({ id: firstNodeId, lon: 0, lat });
  osm.nodes.addNode({ id: firstNodeId + 1, lon: 0.001, lat });
  osm.nodes.addNode({ id: firstNodeId + 2, lon: 0.001, lat: lat + 0.001 });
  osm.ways.addWay({
    id: wayId,
    refs: closed
      ? [firstNodeId, firstNodeId + 1, firstNodeId + 2, firstNodeId]
      : [firstNodeId, firstNodeId + 1],
    tags,
  });
  if (relation === "restriction") {
    osm.ways.addWay({
      id: wayId + 1,
      refs: [firstNodeId + 1, firstNodeId + 2],
      tags: Object.fromEntries(Object.entries(tags).filter(([key]) => key !== "name")),
    });
  }
  if (relation !== "none") {
    osm.relations.addRelation({
      id: wayId * 10,
      tags:
        relation === "route"
          ? { type: "route", route: "foot" }
          : { type: "restriction", restriction: "only_left_turn" },
      members:
        relation === "route"
          ? [{ type: "way", ref: wayId, role: "" }]
          : [
              { type: "way", ref: wayId, role: "from" },
              { type: "node", ref: firstNodeId + 1, role: "via" },
              { type: "way", ref: wayId + 1, role: "to" },
            ],
    });
  }
  if (alternative) {
    osm.nodes.addNode({ id: 11, lon: 0, lat: 0.000008 });
    osm.nodes.addNode({ id: 12, lon: 0.001, lat: 0.000008 });
    osm.ways.addWay({ id: 30, refs: [11, 12], tags });
  }
  osm.buildIndexes();
  osm.buildSpatialIndexes();
  return osm;
}

function createWayFixture(
  conflict: ConflictKind,
  relationSide: "source" | "target",
  relationKind: Exclude<RelationKind, "none"> = "route",
  ambiguity: "none" | "targets" | "sources" = "none",
) {
  const sourceTags: OsmTags = { highway: "footway", name: "Imported" };
  if (conflict === "grade") Object.assign(sourceTags, { bridge: "yes", layer: "1" });
  if (conflict === "access") sourceTags["access"] = "private";
  if (conflict === "protected") sourceTags["layer"] = "0";
  if (conflict === "geometry") sourceTags["area"] = "yes";
  const base = createWayDataset(
    "base",
    1,
    10,
    0,
    { highway: "footway", name: "Base" },
    relationSide === "target" ? relationKind : "none",
    conflict === "geometry",
    ambiguity === "targets",
  );
  const patch = createWayDataset(
    "patch",
    101,
    20,
    0.000004,
    sourceTags,
    relationSide === "source" ? relationKind : "none",
    conflict === "geometry",
    ambiguity === "sources",
  );
  const options: OsmConflationOptions = {
    propertyKeys: conflict === "protected" ? ["layer"] : ["name"],
    attachNetwork: false,
  };
  return { base, patch, options };
}

function entities(osm: Osm) {
  return {
    nodes: [...osm.nodes.sorted()],
    ways: [...osm.ways.sorted()],
    relations: [...osm.relations.sorted()],
  };
}

const acceptWay: OsmConflationDecision = {
  candidateId: "way:20->10",
  action: "accept",
  transferProperties: true,
  attachNetwork: false,
};

describe("hard conflation blockers survive combined review reasons", () => {
  it.each([
    ["grade", "source", "route", "grade-conflict"],
    ["access", "target", "route", "routing-family-conflict"],
    ["protected", "source", "route", "protected-tag"],
    ["geometry", "target", "route", "geometry-mismatch"],
    ["grade", "source", "restriction", "grade-conflict"],
    ["access", "target", "restriction", "routing-family-conflict"],
  ] as const)("keeps %s blocked with %s %s membership", async (conflict, side, kind, reason) => {
    const { base, patch, options } = createWayFixture(conflict, side, kind);
    const discovery = discoverConflationCandidates(base, patch, options);
    expect(discovery.candidates).toHaveLength(1);
    expect(discovery.candidates[0]).toMatchObject({
      id: acceptWay.candidateId,
      status: "blocked",
      reasons: expect.arrayContaining([reason, "relation-member"]),
      propertyTransfer: {
        status: "blocked",
        reasons: expect.arrayContaining([reason, "relation-member"]),
      },
    });
    const bulk = buildConflationBulkDecisionResult(discovery.candidates, [], {
      action: "transfer-properties",
      filter: { entityType: "way" },
    });
    expect(bulk.decisions).toEqual([]);
    expect(bulk.preview).toMatchObject({
      filteredCandidates: 1,
      eligibleCandidates: 0,
      skippedCandidates: 1,
      changedCandidates: 0,
    });
    const baseline = await merge(base, patch, { directMerge: true }, () => {});
    const result = await merge(
      base,
      patch,
      { directMerge: true, conflation: { ...options, decisions: bulk.decisions } },
      () => {},
    );
    expect(entities(result)).toEqual(entities(baseline));
  });

  it("makes explicit acceptance ineffective in generation and the public merge pipeline", async () => {
    const { base, patch, options } = createWayFixture("grade", "source");
    const baseline = await merge(base, patch, { directMerge: true }, () => {});
    const conflation = { ...options, decisions: [acceptWay] };
    const changeset = generateConflationChangeset(base, patch, { directMerge: true, conflation });
    expect(entities(applyChangesetToOsm(changeset))).toEqual(entities(baseline));
    const result = await merge(base, patch, { directMerge: true, conflation }, () => {});
    expect(entities(result)).toEqual(entities(baseline));
  });

  it("keeps blocked acceptance consistent in effective status, summary, and filtering", () => {
    const { base, patch, options } = createWayFixture("grade", "source", "restriction");
    const { candidates } = discoverConflationCandidates(base, patch, options);
    expect(conflationEffectiveStatus(candidates[0]!, [acceptWay])).toBe("blocked");
    expect(summarizeConflationCandidates(candidates, [acceptWay])).toMatchObject({
      accepted: 0,
      blocked: 1,
    });
    expect(filterConflationCandidates(candidates, { status: "blocked" }, [acceptWay])).toEqual(
      candidates,
    );
    expect(filterConflationCandidates(candidates, { status: "accepted" }, [acceptWay])).toEqual([]);
  });

  it("adds ambiguity evidence without relaxing blocked transfers", () => {
    const { base, patch, options } = createWayFixture("grade", "source", "route", "targets");
    const { candidates } = discoverConflationCandidates(base, patch, options);
    expect(candidates).toHaveLength(2);
    for (const candidate of candidates) {
      expect(candidate.propertyTransfer).toMatchObject({
        status: "blocked",
        reasons: expect.arrayContaining(["grade-conflict", "relation-member", "multiple-targets"]),
      });
    }
  });

  it("preserves many-to-one evidence on each blocked action assessment", () => {
    const { base, patch, options } = createWayFixture("grade", "source", "route", "sources");
    const { candidates } = discoverConflationCandidates(base, patch, options);
    expect(candidates).toHaveLength(2);
    for (const candidate of candidates) {
      expect(candidate).toMatchObject({
        targetId: 10,
        status: "blocked",
        reasons: expect.arrayContaining(["grade-conflict", "many-to-one"]),
        propertyTransfer: {
          status: "blocked",
          reasons: expect.arrayContaining(["grade-conflict", "many-to-one"]),
        },
      });
    }
  });

  it("allows a compatible ordinary relation member to be reviewed and copied", async () => {
    const { base, patch, options } = createWayFixture("none", "source");
    const { candidates } = discoverConflationCandidates(base, patch, options);
    expect(candidates[0]?.propertyTransfer).toEqual({
      status: "review",
      reasons: ["relation-member"],
    });
    const result = await merge(
      base,
      patch,
      { directMerge: true, conflation: { ...options, decisions: [acceptWay] } },
      () => {},
    );
    expect(result.ways.getById(10)?.tags?.["name"]).toBe("Imported");
    expect(result.ways.getById(20)).toEqual(patch.ways.getById(20));
    expect([...result.relations]).toEqual([...patch.relations]);
  });

  it("keeps safe property copying usable when relation and access context block attachment", async () => {
    const base = new Osm({ id: "base" });
    base.nodes.addNode({ id: 1, lon: 0, lat: 0, tags: { name: "Base" } });
    base.nodes.addNode({ id: 2, lon: -0.001, lat: 0 });
    base.ways.addWay({ id: 10, refs: [2, 1], tags: { highway: "footway" } });
    base.buildIndexes();
    base.buildSpatialIndexes();
    const patch = new Osm({ id: "patch" });
    patch.nodes.addNode({
      id: 101,
      lon: 0.000005,
      lat: 0,
      tags: { name: "Imported", access: "private" },
    });
    patch.nodes.addNode({ id: 102, lon: 0.001, lat: 0 });
    patch.ways.addWay({ id: 20, refs: [101, 102], tags: { highway: "footway" } });
    patch.relations.addRelation({
      id: 200,
      tags: { type: "route", route: "foot" },
      members: [{ type: "way", ref: 20, role: "" }],
    });
    patch.buildIndexes();
    patch.buildSpatialIndexes();
    const options = { propertyKeys: ["name"], attachNetwork: true };
    const discovery = discoverConflationCandidates(base, patch, options);
    const candidate = discovery.candidates.find((item) => item.id === "node:101->1");
    expect(candidate).toMatchObject({
      status: "automatic",
      propertyTransfer: { status: "automatic" },
      networkAttachment: {
        status: "blocked",
        reasons: expect.arrayContaining(["routing-family-conflict", "relation-member"]),
      },
    });
    const blockedAttachment: OsmConflationDecision = {
      candidateId: "node:101->1",
      action: "accept",
      transferProperties: false,
      attachNetwork: true,
    };
    expect(conflationEffectiveStatus(candidate!, [blockedAttachment])).toBe("blocked");
    expect(summarizeConflationCandidates(discovery.candidates, [blockedAttachment])).toMatchObject({
      accepted: 0,
      blocked: 1,
    });
    const baseline = await merge(base, patch, { directMerge: true }, () => {});
    const blockedResult = await merge(
      base,
      patch,
      { directMerge: true, conflation: { ...options, decisions: [blockedAttachment] } },
      () => {},
    );
    expect(entities(blockedResult)).toEqual(entities(baseline));
    const bulk = buildConflationBulkDecisionResult(discovery.candidates, [blockedAttachment], {
      action: "transfer-properties",
      filter: { entityType: "node" },
    });
    expect(bulk.decisions).toContainEqual({
      candidateId: "node:101->1",
      action: "accept",
      transferProperties: true,
      attachNetwork: false,
    });
    const result = await merge(
      base,
      patch,
      { directMerge: true, conflation: { ...options, decisions: bulk.decisions } },
      () => {},
    );
    expect(result.nodes.getById(1)?.tags).toEqual({ name: "Imported" });
    expect(result.nodes.getById(101)).toEqual(patch.nodes.getById(101));
    expect(result.ways.getById(20)?.refs).toEqual([101, 102]);
    expect([...result.relations]).toEqual([...patch.relations]);
  });
});
