import { Osm } from "@osmix/core";
import type { OsmNode, OsmRelation, OsmWay } from "@osmix/types";
import { describe, expect, it } from "vitest";

import {
  applyChangesetToOsm,
  discoverConflationCandidates,
  generateConflationArtifacts,
  generateConflationChangeset,
  generateChangeset,
  type OsmConflationDecision,
  type OsmConflationOptions,
} from "../src/index.ts";

function createOsm(
  id: string,
  nodes: OsmNode[],
  ways: OsmWay[] = [],
  relations: OsmRelation[] = [],
) {
  const osm = new Osm({ id });
  for (const node of nodes) osm.nodes.addNode(node);
  for (const way of ways) osm.ways.addWay(way);
  for (const relation of relations) osm.relations.addRelation(relation);
  osm.buildIndexes();
  osm.buildSpatialIndexes();
  return osm;
}

const propertyOptions: OsmConflationOptions = { propertyKeys: ["name"], attachNetwork: false };

function generate(
  base: Osm,
  patch: Osm,
  conflation = propertyOptions,
  decisions: OsmConflationDecision[] = [],
) {
  return generateConflationArtifacts(base, patch, { directMerge: true, conflation }, decisions);
}

function propertyPair() {
  const base = createOsm("base", [{ id: 1, lon: 0, lat: 0, tags: { name: "Old" } }]);
  const patch = createOsm("patch", [{ id: 101, lon: 0.000005, lat: 0, tags: { name: "New" } }]);
  return { base, patch };
}

describe("actual conflation outcomes", () => {
  it("reports actual tag copies and keeps the public changeset return compatible", () => {
    const { base, patch } = propertyPair();
    const { outcome, ordinaryBaseline, result } = generate(base, patch);
    expect(ordinaryBaseline.nodes.getById(1)?.tags?.["name"]).toBe("Old");
    expect(result.nodes.getById(1)?.tags?.["name"]).toBe("New");
    expect(outcome.summary).toMatchObject({
      features: 1,
      appliedFeatures: 1,
      tagCopyActions: 1,
      copiedTagValues: 1,
      networkAttachmentActions: 0,
      unresolvedFeatures: 0,
      skippedFeatures: 0,
      unchangedFeatures: 0,
    });
    expect(outcome.features).toMatchObject([
      { entityType: "node", sourceId: 101, copiedKeys: ["name"], unresolved: null },
    ]);
    const changeset = generateConflationChangeset(base, patch, {
      directMerge: true,
      conflation: propertyOptions,
    });
    expect(applyChangesetToOsm(changeset).nodes.getById(1)).toEqual(result.nodes.getById(1));
  });

  it("counts one copy action per source with multiple changed keys and keeps partial failures", () => {
    const base = createOsm("base", [{ id: 1, lon: 0, lat: 0 }]);
    const patch = createOsm("patch", [
      {
        id: 101,
        lon: 0.000005,
        lat: 0,
        tags: { name: "Crossing", description: "Ramp", layer: "1" },
      },
    ]);
    const { outcome, result } = generate(
      base,
      patch,
      { propertyKeys: ["name", "description", "layer", "absent"], attachNetwork: false },
      [
        {
          candidateId: "node:101->1",
          action: "accept",
          transferProperties: true,
          attachNetwork: false,
        },
      ],
    );
    expect(result.nodes.getById(1)?.tags).toEqual({ name: "Crossing", description: "Ramp" });
    expect(outcome.summary).toMatchObject({
      features: 1,
      appliedFeatures: 1,
      tagCopyActions: 1,
      copiedTagValues: 2,
      unresolvedFeatures: 1,
      blockedFeatures: 1,
    });
    expect(outcome.features[0]).toMatchObject({
      copiedKeys: ["description", "name"],
      unresolved: "blocked",
    });
    expect(outcome.tags.find((tag) => tag.key === "layer")?.uncopied).toEqual([
      expect.objectContaining({ entityType: "node", sourceId: 101, reason: "protected-tag" }),
    ]);
    expect(outcome.tags.find((tag) => tag.key === "absent")).toEqual({
      key: "absent",
      presentFeatures: 0,
      copiedFeatures: 0,
      alreadyEqualFeatures: 0,
      satisfiedByOtherCopyFeatures: 0,
      uncopied: [],
    });
  });

  it("credits only the last changing writer when distinct values compete for one node", () => {
    const { base } = propertyPair();
    const patch = createOsm("patch", [
      { id: 101, lon: -0.000003, lat: 0, tags: { name: "First" } },
      { id: 102, lon: 0.000003, lat: 0, tags: { name: "Last" } },
    ]);
    const decisions: OsmConflationDecision[] = [101, 102].map((id) => ({
      candidateId: `node:${id}->1`,
      action: "accept",
      transferProperties: true,
      attachNetwork: false,
    }));
    const { outcome, result } = generate(base, patch, propertyOptions, decisions);
    expect(result.nodes.getById(1)?.tags?.["name"]).toBe("Last");
    expect(outcome.summary).toMatchObject({
      features: 2,
      appliedFeatures: 1,
      tagCopyActions: 1,
      copiedTagValues: 1,
      unresolvedFeatures: 1,
    });
    expect(outcome.features.find((feature) => feature.sourceId === 101)?.copiedKeys).toEqual([]);
    expect(outcome.tags[0]?.uncopied).toEqual([
      expect.objectContaining({ sourceId: 101, reason: "superseded" }),
    ]);
  });

  it("does not displace a surviving writer when another source repeats the same value", () => {
    const { base } = propertyPair();
    const patch = createOsm("patch", [
      { id: 101, lon: -0.000003, lat: 0, tags: { name: "New" } },
      { id: 102, lon: 0.000003, lat: 0, tags: { name: "New" } },
    ]);
    const decisions: OsmConflationDecision[] = [101, 102].map((id) => ({
      candidateId: `node:${id}->1`,
      action: "accept",
      transferProperties: true,
      attachNetwork: false,
    }));
    const { outcome, result } = generate(base, patch, propertyOptions, decisions);
    expect(result.nodes.getById(1)?.tags?.["name"]).toBe("New");
    expect(outcome.summary).toMatchObject({
      features: 2,
      appliedFeatures: 1,
      tagCopyActions: 1,
      copiedTagValues: 1,
      unresolvedFeatures: 0,
      unchangedFeatures: 1,
    });
    expect(outcome.features.find((feature) => feature.sourceId === 101)?.copiedKeys).toEqual([
      "name",
    ]);
    expect(outcome.features.find((feature) => feature.sourceId === 102)?.copiedKeys).toEqual([]);
    expect(outcome.tags[0]).toEqual({
      key: "name",
      presentFeatures: 2,
      copiedFeatures: 1,
      alreadyEqualFeatures: 1,
      satisfiedByOtherCopyFeatures: 0,
      uncopied: [],
    });
  });

  it("separates surviving writer credit from another source satisfied by the final value", () => {
    const { base } = propertyPair();
    const patch = createOsm("patch", [
      { id: 101, lon: -0.000003, lat: 0, tags: { name: "Final" } },
      { id: 102, lon: 0.000002, lat: 0, tags: { name: "Other" } },
      { id: 103, lon: 0.000003, lat: 0, tags: { name: "Final" } },
    ]);
    const decisions: OsmConflationDecision[] = [101, 102, 103].map((id) => ({
      candidateId: `node:${id}->1`,
      action: "accept",
      transferProperties: true,
      attachNetwork: false,
    }));
    const { outcome, result } = generate(base, patch, propertyOptions, decisions);
    expect(result.nodes.getById(1)?.tags?.["name"]).toBe("Final");
    expect(outcome.summary).toMatchObject({
      features: 3,
      appliedFeatures: 1,
      copiedTagValues: 1,
      unresolvedFeatures: 1,
      unchangedFeatures: 1,
    });
    expect(outcome.features.find((feature) => feature.sourceId === 101)).toMatchObject({
      copiedKeys: [],
      unresolved: null,
    });
    expect(outcome.features.find((feature) => feature.sourceId === 103)?.copiedKeys).toEqual([
      "name",
    ]);
    expect(outcome.tags[0]?.satisfiedByOtherCopyFeatures).toBe(1);
    expect(outcome.tags[0]?.uncopied).toEqual([
      expect.objectContaining({ sourceId: 102, reason: "superseded" }),
    ]);
  });

  it("counts a junction attachment once while listing every actually rewritten branch", () => {
    const base = createOsm(
      "base",
      [
        { id: 1, lon: 0, lat: 0 },
        { id: 2, lon: -0.001, lat: 0 },
        { id: 3, lon: 0.001, lat: 0 },
        { id: 4, lon: 0.001, lat: 0.00005 },
      ],
      [{ id: 10, refs: [2, 1], tags: { highway: "footway" } }],
    );
    const patch = createOsm(
      "patch",
      [
        { id: 101, lon: 0.000005, lat: 0 },
        { id: 3, lon: 0.001, lat: 0 },
        { id: 4, lon: 0.001, lat: 0.00005 },
      ],
      [
        { id: 20, refs: [101, 3], tags: { highway: "footway" } },
        { id: 21, refs: [101, 4], tags: { highway: "footway" } },
      ],
    );
    const { outcome, result, ordinaryBaseline } = generate(base, patch, {
      propertyKeys: [],
      attachNetwork: true,
    });
    expect(ordinaryBaseline.ways.getById(20)?.refs).toEqual([101, 3]);
    expect(ordinaryBaseline.ways.getById(21)?.refs).toEqual([101, 4]);
    expect(result.ways.getById(20)?.refs).toEqual([1, 3]);
    expect(result.ways.getById(21)?.refs).toEqual([1, 4]);
    expect(outcome.summary).toMatchObject({
      features: 1,
      appliedFeatures: 1,
      networkAttachmentActions: 1,
      unresolvedFeatures: 0,
    });
    expect(outcome.features[0]?.connectedWayIds).toEqual([20, 21]);
  });

  it("does not credit fuzzy matching for refs already reconciled by the ordinary exact merge", () => {
    const base = createOsm(
      "base",
      [
        { id: 1, lon: 0, lat: 0 },
        { id: 2, lon: -0.001, lat: 0 },
        { id: 3, lon: 0.001, lat: 0 },
      ],
      [{ id: 10, refs: [2, 1], tags: { highway: "footway" } }],
    );
    const patch = createOsm(
      "patch",
      [
        { id: 101, lon: 0, lat: 0, tags: { name: "Already imported" } },
        { id: 3, lon: 0.001, lat: 0 },
      ],
      [{ id: 20, refs: [101, 3], tags: { highway: "footway" } }],
    );
    const options = {
      directMerge: true,
      deduplicateNodes: true,
      conflation: { propertyKeys: ["name"], attachNetwork: true },
    };
    const discovery = discoverConflationCandidates(base, patch, options.conflation);
    expect(discovery.candidates[0]?.networkAttachment?.status).toBe("automatic");
    const { outcome, ordinaryBaseline, result } = generateConflationArtifacts(base, patch, options);
    expect(ordinaryBaseline.ways.getById(20)?.refs).toEqual([1, 3]);
    expect(result.ways.getById(20)?.refs).toEqual([1, 3]);
    expect(ordinaryBaseline.nodes.getById(1)?.tags?.["name"]).toBe("Already imported");
    expect(outcome.tags[0]).toMatchObject({
      copiedFeatures: 0,
      alreadyEqualFeatures: 1,
      uncopied: [],
    });
    expect(outcome.summary).toMatchObject({
      features: 1,
      appliedFeatures: 0,
      networkAttachmentActions: 0,
      unresolvedFeatures: 0,
      unchangedFeatures: 1,
    });
    expect(outcome.features[0]).toMatchObject({
      connectedWayIds: [],
      retained: false,
      ordinaryAddition: false,
    });
    expect(outcome.retainedImports).toEqual({
      originalIds: { nodes: 1, ways: 1, relations: 0 },
      ordinaryAdditions: { nodes: 0, ways: 1, relations: 0 },
    });
  });

  it("reports same-ID updates and unconsidered imports only as retained ordinary entities", () => {
    const { base } = propertyPair();
    const patch = createOsm(
      "patch",
      [
        { id: 1, lon: 0, lat: 0, tags: { name: "New" } },
        { id: 101, lon: 0.01, lat: 0, tags: { description: "Unselected" } },
        { id: 102, lon: 0.02, lat: 0 },
      ],
      [{ id: 20, refs: [101, 102] }],
      [{ id: 30, members: [{ type: "way", ref: 20, role: "" }], tags: { type: "collection" } }],
    );
    const { outcome, result } = generate(base, patch);
    expect(result.nodes.getById(1)?.tags?.["name"]).toBe("New");
    expect(outcome.features).toEqual([]);
    expect(outcome.summary).toMatchObject({
      features: 0,
      appliedFeatures: 0,
      unresolvedFeatures: 0,
    });
    expect(outcome.tags[0]?.presentFeatures).toBe(0);
    expect(outcome.retainedImports).toEqual({
      originalIds: { nodes: 3, ways: 1, relations: 1 },
      ordinaryAdditions: { nodes: 2, ways: 1, relations: 1 },
    });
  });

  it("counts equal values across every alternative without inventing a selected target", () => {
    const base = createOsm("base", [
      { id: 1, lon: 0, lat: 0, tags: { name: "Same" } },
      { id: 2, lon: 0.000004, lat: 0, tags: { name: "Same" } },
    ]);
    const patch = createOsm("patch", [{ id: 101, lon: 0.000002, lat: 0, tags: { name: "Same" } }]);
    const { outcome } = generate(base, patch);
    expect(outcome.features[0]).toMatchObject({
      candidateIds: ["node:101->1", "node:101->2"],
      targetId: null,
      unresolved: null,
    });
    expect(outcome.summary).toMatchObject({
      features: 1,
      unchangedFeatures: 1,
      unresolvedFeatures: 0,
    });
    expect(outcome.tags[0]).toEqual({
      key: "name",
      presentFeatures: 1,
      copiedFeatures: 0,
      alreadyEqualFeatures: 1,
      satisfiedByOtherCopyFeatures: 0,
      uncopied: [],
    });
    const partial = createOsm("partial", [
      { id: 101, lon: 0.000002, lat: 0, tags: { name: "Same", description: "New" } },
    ]);
    const partialReport = generate(base, partial, {
      propertyKeys: ["name", "description"],
      attachNetwork: false,
    }).outcome;
    expect(partialReport.tags.find((tag) => tag.key === "name")?.alreadyEqualFeatures).toBe(1);
    expect(partialReport.features[0]?.unresolved).toBe("ambiguous");
    expect(partialReport.tags.find((tag) => tag.key === "description")?.uncopied).toHaveLength(1);
    const networkPatch = createOsm(
      "network",
      [
        { id: 101, lon: 0.000002, lat: 0, tags: { name: "Same" } },
        { id: 102, lon: 0.001, lat: 0 },
      ],
      [{ id: 20, refs: [101, 102], tags: { highway: "footway" } }],
    );
    const networkReport = generate(base, networkPatch, {
      propertyKeys: ["name"],
      attachNetwork: true,
    }).outcome;
    expect(networkReport.tags[0]?.alreadyEqualFeatures).toBe(1);
    expect(networkReport.features.find((feature) => feature.sourceId === 101)?.unresolved).toBe(
      "blocked",
    );
  });

  it.each(["uncontrolled", "traffic_signals", "no"])(
    "preserves the reported crossing=%s value through later intersection creation",
    (crossing) => {
      const base = createOsm(
        "base",
        [
          { id: 1, lon: 0, lat: 0 },
          { id: 2, lon: -0.001, lat: 0 },
        ],
        [{ id: 10, refs: [2, 1], tags: { highway: "footway" } }],
      );
      const patch = createOsm(
        "patch",
        [
          { id: 101, lon: 0.000005, lat: 0, tags: { crossing } },
          { id: 103, lon: -0.001, lat: 0.001 },
          { id: 104, lon: 0.001, lat: -0.001 },
        ],
        [{ id: 20, refs: [103, 104], tags: { highway: "footway" } }],
      );
      const { outcome, result } = generate(
        base,
        patch,
        { propertyKeys: ["crossing"], attachNetwork: false },
        [
          {
            candidateId: "node:101->1",
            action: "accept",
            transferProperties: true,
            attachNetwork: false,
          },
        ],
      );
      expect(result.nodes.getById(1)?.tags?.["crossing"]).toBe(crossing);
      expect(outcome.features[0]).toMatchObject({ copiedKeys: ["crossing"], unresolved: null });
      const final = applyChangesetToOsm(
        generateChangeset(result, patch, { createIntersections: true }, () => {}),
      );
      expect(final.ways.getById(20)?.refs).toEqual([103, 1, 104]);
      expect(final.nodes.getById(1)?.tags?.["crossing"]).toBe(crossing);
    },
  );

  it("recomputes after decisions without mutating the earlier report or equating skip with failure", () => {
    const { base, patch } = propertyPair();
    const first = generate(base, patch);
    const saved = structuredClone(first.outcome);
    const skipped = generate(base, patch, propertyOptions, [
      {
        candidateId: "node:101->1",
        action: "accept",
        transferProperties: false,
        attachNetwork: false,
      },
    ]);
    expect(skipped.result.nodes.getById(1)?.tags?.["name"]).toBe("Old");
    expect(skipped.outcome.summary).toMatchObject({
      appliedFeatures: 0,
      unresolvedFeatures: 0,
      skippedFeatures: 1,
    });
    expect(skipped.outcome.tags[0]?.uncopied[0]?.reason).toBe("not-selected");
    expect(first.outcome).toEqual(saved);
    first.outcome.features[0]?.copiedKeys.push("caller-change");
    first.outcome.tags[0]?.uncopied.push({
      entityType: "node",
      sourceId: 999,
      reason: "blocked",
      reasons: [],
    });
    expect(generate(base, patch).outcome).toEqual(saved);
  });

  it("reports review and unmatched sources when no matching action applies", () => {
    const { base } = propertyPair();
    const patch = createOsm("patch", [
      { id: 101, lon: 0.000005, lat: 0, tags: { name: "New" } },
      { id: 102, lon: 0.01, lat: 0, tags: { name: "Remote" } },
    ]);
    const { outcome, result } = generate(base, patch, { ...propertyOptions, automatic: "none" });
    expect(result.nodes.getById(1)?.tags?.["name"]).toBe("Old");
    expect(outcome.summary).toMatchObject({
      features: 2,
      appliedFeatures: 0,
      unresolvedFeatures: 2,
      reviewFeatures: 1,
      unmatchedFeatures: 1,
    });
    expect(outcome.features.map((feature) => feature.unresolved)).toEqual(["review", "unmatched"]);
  });
});
