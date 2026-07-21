import { Osm } from "@osmix/core";
import type { OsmNode, OsmRelation, OsmWay } from "@osmix/types";
import { describe, expect, it } from "vitest";

import { applyChangesetToOsm } from "../src/apply-changeset.ts";
import {
  buildConflationBulkDecisionResult,
  discoverConflationCandidates,
  filterConflationCandidates,
  generateConflationApplicationChangeset,
  generateConflationChangeset,
  summarizeConflationCandidates,
  validateConflationDecisions,
} from "../src/conflation.ts";
import { generateChangeset } from "../src/generate-changeset.ts";
import { merge } from "../src/merge.ts";
import type {
  OsmConflationCandidate,
  OsmConflationDecision,
  OsmConflationOptions,
} from "../src/types.ts";

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

const silent = () => {};

const attachmentOptions: OsmConflationOptions = {
  propertyKeys: [],
  attachNetwork: true,
};

describe("safe fuzzy conflation discovery", () => {
  it("automatically attaches a unique aligned imported sidewalk without moving the base", async () => {
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
        { id: 101, lon: 0.000005, lat: 0 },
        { id: 102, lon: 0.001, lat: 0 },
      ],
      [{ id: 20, refs: [101, 102], tags: { highway: "footway" } }],
    );

    const discovery = discoverConflationCandidates(base, patch, attachmentOptions);
    const match = discovery.candidates.find((candidate) => candidate.sourceId === 101);
    expect(match).toMatchObject({
      id: "node:101->1",
      status: "automatic",
      networkAttachment: { status: "automatic" },
    });
    expect(match?.evidence.distanceMeters).toBeGreaterThan(0.5);
    expect(match?.evidence.distanceMeters).toBeLessThan(0.6);

    const result = await merge(
      base,
      patch,
      { directMerge: true, conflation: attachmentOptions },
      silent,
    );
    expect(result.nodes.getById(1)).toMatchObject({ lon: 0, lat: 0 });
    expect(result.nodes.ids.has(101)).toBe(true);
    expect(result.ways.getById(10)?.refs).toEqual([2, 1]);
    expect(result.ways.getById(20)?.refs).toEqual([1, 102]);
    const cumulative = applyChangesetToOsm(
      generateConflationChangeset(base, patch, {
        directMerge: true,
        conflation: attachmentOptions,
      }),
    );
    expect([...cumulative.nodes].map((node) => node.id)).toEqual(
      [...result.nodes].map((node) => node.id),
    );
    expect(cumulative.ways.getById(20)?.refs).toEqual(result.ways.getById(20)?.refs);
  });

  it("blocks an area-only school boundary vertex near a routing node", () => {
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
        { id: 101, lon: 0.000005, lat: 0 },
        { id: 102, lon: 0.001, lat: 0 },
        { id: 103, lon: 0.001, lat: 0.001 },
      ],
      [
        {
          id: 20,
          refs: [101, 102, 103, 101],
          tags: { boundary: "school", area: "yes" },
        },
      ],
    );

    const match = discoverConflationCandidates(base, patch, attachmentOptions).candidates.find(
      (candidate) => candidate.sourceId === 101,
    );
    expect(match?.status).toBe("blocked");
    expect(match?.reasons).toContain("non-routing-target");
  });

  it("does not automatically transfer properties between a footway and school boundary", () => {
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
        { id: 101, lon: 0.000005, lat: 0, tags: { name: "School boundary" } },
        { id: 102, lon: 0.001, lat: 0 },
        { id: 103, lon: 0.001, lat: 0.001 },
      ],
      [
        {
          id: 20,
          refs: [101, 102, 103, 101],
          tags: { boundary: "school", area: "yes" },
        },
      ],
    );
    const candidate = discoverConflationCandidates(base, patch, {
      propertyKeys: ["name"],
      attachNetwork: false,
    }).candidates.find((item) => item.sourceId === 101);
    expect(candidate?.propertyTransfer.status).toBe("blocked");
    expect(candidate?.propertyTransfer.reasons).toContain("non-routing-target");
  });

  it("classifies multiple targets and many-to-one matches for review", () => {
    const base = createOsm("base", [
      { id: 1, lon: -0.000003, lat: 0, tags: { name: "A" } },
      { id: 2, lon: 0.000003, lat: 0, tags: { name: "B" } },
      { id: 3, lon: 0.001, lat: 0, tags: { name: "C" } },
    ]);
    const patch = createOsm("patch", [
      { id: 101, lon: 0, lat: 0, tags: { name: "Imported A" } },
      { id: 102, lon: 0.001005, lat: 0, tags: { name: "Imported C 1" } },
      { id: 103, lon: 0.000995, lat: 0, tags: { name: "Imported C 2" } },
    ]);

    const discovery = discoverConflationCandidates(base, patch, {
      propertyKeys: ["name"],
      attachNetwork: false,
    });
    const ambiguous = discovery.candidates.filter((candidate) => candidate.sourceId === 101);
    expect(ambiguous).toHaveLength(2);
    expect(ambiguous.every((candidate) => candidate.status === "review")).toBe(true);
    expect(ambiguous.every((candidate) => candidate.reasons.includes("multiple-targets"))).toBe(
      true,
    );
    const manyToOne = discovery.candidates.filter((candidate) => candidate.targetId === 3);
    expect(manyToOne).toHaveLength(2);
    expect(manyToOne.every((candidate) => candidate.reasons.includes("many-to-one"))).toBe(true);
  });

  it("keeps decision summaries and filters lightweight", () => {
    const base = createOsm("base", [{ id: 1, lon: 0, lat: 0, tags: { name: "Base" } }]);
    const patch = createOsm("patch", [{ id: 101, lon: 0.000005, lat: 0, tags: { name: "Patch" } }]);
    const discovery = discoverConflationCandidates(base, patch, {
      propertyKeys: ["name"],
      attachNetwork: false,
    });
    const decisions = [{ candidateId: "node:101->1", action: "reject" as const }];
    expect(summarizeConflationCandidates(discovery.candidates, decisions)).toMatchObject({
      total: 1,
      automatic: 0,
      rejected: 1,
    });
    expect(
      filterConflationCandidates(discovery.candidates, { status: "rejected" }, decisions),
    ).toHaveLength(1);

    const accepted = [{ candidateId: "node:101->1", action: "accept" as const }];
    expect(summarizeConflationCandidates(discovery.candidates, accepted)).toMatchObject({
      total: 1,
      accepted: 1,
      automatic: 0,
    });
    expect(
      filterConflationCandidates(discovery.candidates, { status: "accepted" }, accepted),
    ).toHaveLength(1);
  });

  it("builds filter-wide action-specific decisions and skips ambiguous candidates", () => {
    const automatic: OsmConflationCandidate = {
      id: "node:101->1",
      entityType: "node",
      sourceId: 101,
      targetId: 1,
      status: "automatic",
      reasons: [],
      propertyTransfer: { status: "automatic", reasons: [] },
      networkAttachment: { status: "automatic", reasons: [] },
      evidence: {
        distanceMeters: 0.5,
        sourceRoutingFamilies: ["pedestrian"],
        targetRoutingFamilies: ["pedestrian"],
        tagDiff: [{ key: "name", patchValue: "Imported", protected: false, routing: false }],
      },
    };
    const review: OsmConflationCandidate = {
      ...structuredClone(automatic),
      id: "node:102->2",
      sourceId: 102,
      targetId: 2,
      status: "review",
      reasons: ["routing-property"],
      propertyTransfer: { status: "review", reasons: ["routing-property"] },
    };
    const ambiguous: OsmConflationCandidate = {
      ...structuredClone(review),
      id: "node:103->3",
      sourceId: 103,
      targetId: 3,
      reasons: ["multiple-targets"],
      propertyTransfer: { status: "review", reasons: ["multiple-targets"] },
      networkAttachment: { status: "review", reasons: ["multiple-targets"] },
    };
    const blocked: OsmConflationCandidate = {
      ...structuredClone(automatic),
      id: "node:104->4",
      sourceId: 104,
      targetId: 4,
      status: "blocked",
      reasons: ["grade-conflict"],
      propertyTransfer: { status: "blocked", reasons: ["grade-conflict"] },
      networkAttachment: { status: "blocked", reasons: ["grade-conflict"] },
    };
    const candidates = [automatic, review, ambiguous, blocked];
    const initialDecisions: OsmConflationDecision[] = [
      { candidateId: review.id, action: "reject" },
    ];

    const propertyResult = buildConflationBulkDecisionResult(candidates, initialDecisions, {
      action: "transfer-properties",
      filter: { entityType: "node" },
    });
    expect(propertyResult.preview).toEqual({
      action: "transfer-properties",
      filteredCandidates: 4,
      eligibleCandidates: 2,
      changedCandidates: 2,
      skippedCandidates: 2,
      automaticCandidates: 1,
      reviewCandidates: 1,
      overriddenDecisions: 1,
    });
    expect(propertyResult.decisions).toEqual([
      {
        candidateId: automatic.id,
        action: "accept",
        transferProperties: true,
        attachNetwork: true,
      },
      {
        candidateId: review.id,
        action: "accept",
        transferProperties: true,
        attachNetwork: false,
      },
    ]);
    expect(propertyResult.summary).toMatchObject({ accepted: 2, blocked: 1, review: 1 });

    const networkResult = buildConflationBulkDecisionResult(candidates, propertyResult.decisions, {
      action: "attach-network",
      filter: { status: "accepted" },
    });
    expect(networkResult.preview).toMatchObject({
      filteredCandidates: 2,
      eligibleCandidates: 2,
      changedCandidates: 1,
      skippedCandidates: 0,
      overriddenDecisions: 1,
    });
    expect(networkResult.decisions.find((decision) => decision.candidateId === review.id)).toEqual({
      candidateId: review.id,
      action: "accept",
      transferProperties: true,
      attachNetwork: true,
    });

    const rejectResult = buildConflationBulkDecisionResult(candidates, networkResult.decisions, {
      action: "reject",
      filter: { status: "accepted" },
    });
    expect(rejectResult.preview).toMatchObject({
      filteredCandidates: 2,
      eligibleCandidates: 2,
      changedCandidates: 2,
      skippedCandidates: 0,
      overriddenDecisions: 2,
    });
    expect(rejectResult.summary).toMatchObject({ rejected: 2, blocked: 1, review: 1 });

    const scopedResult = buildConflationBulkDecisionResult(
      candidates,
      [...networkResult.decisions, { candidateId: blocked.id, action: "reject" }],
      { action: "reject", filter: { sourceId: automatic.sourceId } },
    );
    expect(scopedResult.decisions).toContainEqual({
      candidateId: blocked.id,
      action: "reject",
    });
  });

  it("validates required configuration fields for untyped callers", () => {
    const base = createOsm("base", []);
    const patch = createOsm("patch", []);
    expect(() =>
      discoverConflationCandidates(base, patch, {
        attachNetwork: false,
      } as unknown as OsmConflationOptions),
    ).toThrow("propertyKeys must be an array");
    expect(() =>
      discoverConflationCandidates(base, patch, {
        propertyKeys: [""],
        attachNetwork: false,
      }),
    ).toThrow("non-empty strings");
    expect(() =>
      discoverConflationCandidates(base, patch, {
        propertyKeys: ["name"],
      } as unknown as OsmConflationOptions),
    ).toThrow("attachNetwork must be a boolean");
  });

  it("rejects stale, duplicate, and malformed decisions at the generation boundary", () => {
    const base = createOsm("base", [{ id: 1, lon: 0, lat: 0, tags: { name: "Base" } }]);
    const patch = createOsm("patch", [{ id: 101, lon: 0.000005, lat: 0, tags: { name: "Patch" } }]);
    const conflation = { propertyKeys: ["name"], attachNetwork: false };
    const discovery = discoverConflationCandidates(base, patch, conflation);
    const generate = (decisions: readonly OsmConflationDecision[]) =>
      generateConflationApplicationChangeset(base, patch, discovery, base, decisions);
    const validDecisions: OsmConflationDecision[] = [
      { candidateId: "node:101->1", action: "accept", transferProperties: true },
    ];
    const beforeValidation = structuredClone(validDecisions);
    expect(() => validateConflationDecisions(discovery.candidates, validDecisions)).not.toThrow();
    expect(validDecisions).toEqual(beforeValidation);

    expect(() => generate([{ candidateId: "node:missing->1", action: "accept" }])).toThrow(
      "Unknown conflation candidate: node:missing->1",
    );
    expect(() =>
      generate([
        { candidateId: "node:101->1", action: "accept" },
        { candidateId: "node:101->1", action: "reject" },
      ]),
    ).toThrow("Duplicate conflation decision for node:101->1");
    expect(() =>
      generate([
        { candidateId: "node:101->1", action: "approve" },
      ] as unknown as OsmConflationDecision[]),
    ).toThrow("Invalid conflation decision action for node:101->1");
    expect(() =>
      generate([
        { candidateId: "node:101->1", action: "accept", transferProperties: "yes" },
      ] as unknown as OsmConflationDecision[]),
    ).toThrow("transferProperties must be a boolean for node:101->1");
    expect(() =>
      generate([
        { candidateId: "node:101->1", action: "accept", attachNetwork: null },
      ] as unknown as OsmConflationDecision[]),
    ).toThrow("attachNetwork must be a boolean for node:101->1");
    expect(() => generate({} as unknown as OsmConflationDecision[])).toThrow(
      "Conflation decisions must be an array",
    );

    expect(() =>
      generateConflationChangeset(base, patch, {
        directMerge: true,
        conflation: {
          ...conflation,
          decisions: [{ candidateId: "node:stale->1", action: "reject" }],
        },
      }),
    ).toThrow("Unknown conflation candidate: node:stale->1");
  });

  it("rejects unknown decisions through the high-level merge API", async () => {
    const base = createOsm("base", [{ id: 1, lon: 0, lat: 0, tags: { name: "Base" } }]);
    const patch = createOsm("patch", [{ id: 101, lon: 0.000005, lat: 0, tags: { name: "Patch" } }]);
    await expect(
      merge(
        base,
        patch,
        {
          directMerge: true,
          conflation: {
            propertyKeys: ["name"],
            attachNetwork: false,
            decisions: [{ candidateId: "node:stale->1", action: "reject" }],
          },
        },
        silent,
      ),
    ).rejects.toThrow("Unknown conflation candidate: node:stale->1");
  });

  it("recomputes canonical candidates instead of trusting caller-mutated discovery data", () => {
    const base = createOsm(
      "base",
      [
        { id: 1, lon: 0, lat: 0 },
        { id: 2, lon: -0.001, lat: 0 },
      ],
      [
        {
          id: 10,
          refs: [2, 1],
          tags: { highway: "footway", layer: "-1", tunnel: "yes" },
        },
      ],
    );
    const patch = createOsm(
      "patch",
      [
        { id: 101, lon: 0.000005, lat: 0 },
        { id: 102, lon: 0.001, lat: 0 },
      ],
      [{ id: 20, refs: [101, 102], tags: { highway: "footway" } }],
    );
    const discovery = discoverConflationCandidates(base, patch, attachmentOptions);
    const forged = {
      ...discovery,
      candidates: discovery.candidates.map((candidate) =>
        candidate.sourceId === 101
          ? {
              ...candidate,
              targetId: 2,
              status: "automatic" as const,
              reasons: [],
              networkAttachment: { status: "automatic" as const, reasons: [] },
              evidence: { ...candidate.evidence, patchWayIds: [20] },
            }
          : candidate,
      ),
    };

    const cumulative = applyChangesetToOsm(
      generateConflationChangeset(
        base,
        patch,
        { directMerge: true, conflation: attachmentOptions },
        [],
        forged,
      ),
    );
    expect(cumulative.ways.getById(20)?.refs).toEqual([101, 102]);

    const direct = applyChangesetToOsm(generateChangeset(base, patch, { directMerge: true }));
    const fuzzyOnly = applyChangesetToOsm(
      generateConflationApplicationChangeset(direct, patch, forged, base),
    );
    expect(fuzzyOnly.ways.getById(20)?.refs).toEqual([101, 102]);
  });
});

describe("safe fuzzy property transfer", () => {
  it("overwrites only selected properties and retains the imported point geometry", async () => {
    const base = createOsm("base", [
      { id: 1, lon: 0, lat: 0, tags: { amenity: "cafe", name: "Old" } },
    ]);
    const patch = createOsm("patch", [
      {
        id: 101,
        lon: 0.000005,
        lat: 0,
        tags: { amenity: "school", name: "Imported", source: "survey" },
      },
    ]);

    const result = await merge(
      base,
      patch,
      {
        directMerge: true,
        conflation: { propertyKeys: ["name", "missing"], attachNetwork: false },
      },
      silent,
    );
    expect(result.nodes.getById(1)?.tags).toEqual({ amenity: "cafe", name: "Imported" });
    expect(result.nodes.getById(101)?.tags).toEqual({
      amenity: "school",
      name: "Imported",
      source: "survey",
    });
  });

  it("blocks structural tags and requires review for routing tags", () => {
    const base = createOsm("base", [{ id: 1, lon: 0, lat: 0 }]);
    const patch = createOsm("patch", [
      {
        id: 101,
        lon: 0.000005,
        lat: 0,
        tags: { highway: "crossing", layer: "1" },
      },
    ]);
    const protectedMatch = discoverConflationCandidates(base, patch, {
      propertyKeys: ["layer"],
      attachNetwork: false,
    }).candidates[0];
    expect(protectedMatch?.propertyTransfer).toEqual({
      status: "blocked",
      reasons: ["protected-tag"],
    });

    const routingMatch = discoverConflationCandidates(base, patch, {
      propertyKeys: ["highway"],
      attachNetwork: false,
    }).candidates[0];
    expect(routingMatch?.propertyTransfer).toEqual({
      status: "review",
      reasons: ["routing-property"],
    });
  });

  it("requires review for conditional and namespaced modal routing properties", () => {
    const base = createOsm("base", [{ id: 1, lon: 0, lat: 0 }]);
    const patch = createOsm("patch", [
      {
        id: 101,
        lon: 0.000005,
        lat: 0,
        tags: {
          "foot:conditional": "no @ (snow)",
          "kerb:left": "lowered",
          "motorcycle:conditional": "no @ (wet)",
          "maxspeed:hgv:conditional": "30 @ (weight>7.5)",
        },
      },
    ]);
    const candidate = discoverConflationCandidates(base, patch, {
      propertyKeys: [
        "foot:conditional",
        "kerb:left",
        "motorcycle:conditional",
        "maxspeed:hgv:conditional",
      ],
      attachNetwork: false,
    }).candidates[0];

    expect(candidate?.propertyTransfer).toEqual({
      status: "review",
      reasons: ["routing-property"],
    });
    expect(candidate?.evidence.tagDiff.every((diff) => diff.routing)).toBe(true);
  });

  it("applies an explicitly reviewed routing property but never a protected property", async () => {
    const base = createOsm("base", [{ id: 1, lon: 0, lat: 0 }]);
    const patch = createOsm("patch", [
      {
        id: 101,
        lon: 0.000005,
        lat: 0,
        tags: { highway: "crossing", layer: "1" },
      },
    ]);
    const conflation: OsmConflationOptions = {
      propertyKeys: ["highway", "layer"],
      attachNetwork: false,
      decisions: [{ candidateId: "node:101->1", action: "accept" }],
    };
    const result = await merge(base, patch, { directMerge: true, conflation }, silent);
    expect(result.nodes.getById(1)?.tags).toEqual({ highway: "crossing" });
  });

  it("matches reversed one-to-one ways and removes only redundant imported geometry", async () => {
    const base = createOsm(
      "base",
      [
        { id: 1, lon: 0, lat: 0 },
        { id: 2, lon: 0.001, lat: 0 },
      ],
      [{ id: 10, refs: [1, 2], tags: { highway: "footway", name: "Old" } }],
    );
    const patch = createOsm(
      "patch",
      [
        { id: 101, lon: 0.001, lat: 0.000004 },
        { id: 102, lon: 0, lat: 0.000004 },
        { id: 999, lon: 0.01, lat: 0.01 },
      ],
      [{ id: 20, refs: [101, 102], tags: { highway: "footway", name: "Imported" } }],
    );
    const options = { propertyKeys: ["name"], attachNetwork: false };
    const candidate = discoverConflationCandidates(base, patch, options).candidates.find(
      (item) => item.entityType === "way",
    );
    expect(candidate).toMatchObject({ sourceId: 20, targetId: 10, status: "automatic" });

    const result = await merge(base, patch, { directMerge: true, conflation: options }, silent);
    expect(result.ways.getById(10)?.refs).toEqual([1, 2]);
    expect(result.ways.getById(10)?.tags?.["name"]).toBe("Imported");
    expect(result.ways.ids.has(20)).toBe(false);
    expect(result.nodes.ids.has(101)).toBe(false);
    expect(result.nodes.ids.has(102)).toBe(false);
    expect(result.nodes.ids.has(999)).toBe(true);
  });

  it("allows selected patch-wins properties on exact node and way geometry", async () => {
    const base = createOsm(
      "base",
      [
        { id: 1, lon: 0, lat: 0, tags: { ref: "base" } },
        { id: 2, lon: 0.001, lat: 0 },
      ],
      [{ id: 10, refs: [1, 2], tags: { highway: "footway", surface: "gravel" } }],
    );
    const patch = createOsm(
      "patch",
      [
        { id: 101, lon: 0, lat: 0, tags: { ref: "patch" } },
        { id: 201, lon: 0, lat: 0 },
        { id: 202, lon: 0.001, lat: 0 },
      ],
      [{ id: 20, refs: [201, 202], tags: { highway: "footway", surface: "paved" } }],
    );
    const conflation = { propertyKeys: ["ref", "surface"], attachNetwork: false };
    const discovery = discoverConflationCandidates(base, patch, conflation);
    expect(discovery.candidates).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: "node:101->1", status: "automatic" }),
        expect.objectContaining({ id: "way:20->10", status: "automatic" }),
      ]),
    );
    const result = await merge(
      base,
      patch,
      {
        directMerge: true,
        deduplicateNodes: true,
        deduplicateWays: true,
        conflation,
      },
      silent,
    );
    expect(result.nodes.getById(1)?.tags?.["ref"]).toBe("patch");
    expect(result.ways.getById(10)?.tags?.["surface"]).toBe("paved");
    expect(result.ways.ids.has(20)).toBe(false);
  });

  it("keeps same-ID patch updates authoritative over nearby fuzzy sources", async () => {
    const base = createOsm("base", [{ id: 1, lon: 0, lat: 0, tags: { name: "Base" } }]);
    const patch = createOsm("patch", [
      { id: 1, lon: 0, lat: 0, tags: { name: "Same-ID authoritative" } },
      { id: 101, lon: 0.000005, lat: 0, tags: { name: "Nearby fuzzy" } },
    ]);
    const conflation = { propertyKeys: ["name"], attachNetwork: false };
    const discovery = discoverConflationCandidates(base, patch, conflation);
    expect(discovery.candidates.find((candidate) => candidate.sourceId === 101)).toMatchObject({
      status: "unmatched",
      targetId: null,
    });
    const result = await merge(base, patch, { directMerge: true, conflation }, silent);
    expect(result.nodes.getById(1)?.tags?.["name"]).toBe("Same-ID authoritative");
  });

  it("does not suppress a geometrically reversed way with incompatible oneway semantics", async () => {
    const base = createOsm(
      "base",
      [
        { id: 1, lon: 0, lat: 0 },
        { id: 2, lon: 0.001, lat: 0 },
      ],
      [
        {
          id: 10,
          refs: [1, 2],
          tags: { highway: "residential", oneway: "yes", name: "Base" },
        },
      ],
    );
    const patch = createOsm(
      "patch",
      [
        { id: 101, lon: 0.001, lat: 0.000004 },
        { id: 102, lon: 0, lat: 0.000004 },
      ],
      [
        {
          id: 20,
          refs: [101, 102],
          tags: { highway: "residential", oneway: "yes", name: "Imported" },
        },
      ],
    );
    const conflation = { propertyKeys: ["name"], attachNetwork: false };
    const result = await merge(base, patch, { directMerge: true, conflation }, silent);
    expect(result.ways.getById(10)?.tags?.["name"]).toBe("Base");
    expect(result.ways.ids.has(20)).toBe(true);
  });

  it("does not suppress an equivalent way with a conditional access conflict", async () => {
    const base = createOsm(
      "base",
      [
        { id: 1, lon: 0, lat: 0 },
        { id: 2, lon: 0.001, lat: 0 },
      ],
      [
        {
          id: 10,
          refs: [1, 2],
          tags: { highway: "footway", name: "Base", "wheelchair:conditional": "yes @ (dry)" },
        },
      ],
    );
    const patch = createOsm(
      "patch",
      [
        { id: 101, lon: 0, lat: 0.000004 },
        { id: 102, lon: 0.001, lat: 0.000004 },
      ],
      [
        {
          id: 20,
          refs: [101, 102],
          tags: { highway: "footway", name: "Imported", "wheelchair:conditional": "no @ (wet)" },
        },
      ],
    );
    const conflation = { propertyKeys: ["name"], attachNetwork: false };
    const candidate = discoverConflationCandidates(base, patch, conflation).candidates.find(
      (item) => item.entityType === "way",
    );

    expect(candidate).toMatchObject({
      targetId: 10,
      status: "blocked",
      reasons: ["routing-family-conflict"],
    });
    const result = await merge(base, patch, { directMerge: true, conflation }, silent);
    expect(result.ways.getById(10)?.tags?.["name"]).toBe("Base");
    expect(result.ways.ids.has(20)).toBe(true);
  });

  it("does not suppress reversed geometry with directional routing tags", async () => {
    const base = createOsm(
      "base",
      [
        { id: 1, lon: 0, lat: 0 },
        { id: 2, lon: 0.001, lat: 0 },
      ],
      [
        {
          id: 10,
          refs: [1, 2],
          tags: { highway: "footway", "kerb:left": "lowered", name: "Base" },
        },
      ],
    );
    const patch = createOsm(
      "patch",
      [
        { id: 101, lon: 0.001, lat: 0.000004 },
        { id: 102, lon: 0, lat: 0.000004 },
      ],
      [
        {
          id: 20,
          refs: [101, 102],
          tags: { highway: "footway", "kerb:left": "lowered", name: "Imported" },
        },
      ],
    );
    const conflation = { propertyKeys: ["name"], attachNetwork: false };
    const candidate = discoverConflationCandidates(base, patch, conflation).candidates.find(
      (item) => item.entityType === "way",
    );

    expect(candidate).toMatchObject({
      targetId: 10,
      status: "blocked",
      reasons: ["routing-family-conflict"],
    });
    const result = await merge(base, patch, { directMerge: true, conflation }, silent);
    expect(result.ways.getById(10)?.tags?.["name"]).toBe("Base");
    expect(result.ways.ids.has(20)).toBe(true);
  });

  it("blocks a sub-meter way match whose true relative length differs by over five percent", async () => {
    const base = createOsm(
      "base",
      [
        { id: 1, lon: 0, lat: 0 },
        { id: 2, lon: 0.000000898, lat: 0 },
      ],
      [{ id: 10, refs: [1, 2], tags: { highway: "footway", name: "Base" } }],
    );
    const patch = createOsm(
      "patch",
      [
        { id: 101, lon: 0, lat: 0.000004 },
        { id: 102, lon: 0.000001257, lat: 0.000004 },
      ],
      [{ id: 20, refs: [101, 102], tags: { highway: "footway", name: "Imported" } }],
    );
    const conflation = { propertyKeys: ["name"], attachNetwork: false };
    const candidate = discoverConflationCandidates(base, patch, conflation).candidates.find(
      (item) => item.entityType === "way",
    );

    expect(candidate).toMatchObject({ targetId: 10, status: "blocked" });
    expect(candidate?.reasons).toContain("length-mismatch");
    expect(candidate?.evidence.lengthDifferenceRatio).toBeGreaterThan(0.25);
    const result = await merge(base, patch, { directMerge: true, conflation }, silent);
    expect(result.ways.getById(10)?.tags?.["name"]).toBe("Base");
    expect(result.ways.ids.has(20)).toBe(true);
  });

  it("reports a geometrically plausible grade-conflicting way instead of hiding it as unmatched", async () => {
    const base = createOsm(
      "base",
      [
        { id: 1, lon: 0, lat: 0 },
        { id: 2, lon: 0.001, lat: 0 },
      ],
      [
        {
          id: 10,
          refs: [1, 2],
          tags: { highway: "footway", tunnel: "yes", layer: "-1", name: "Tunnel" },
        },
      ],
    );
    const patch = createOsm(
      "patch",
      [
        { id: 101, lon: 0, lat: 0.000004 },
        { id: 102, lon: 0.001, lat: 0.000004 },
      ],
      [{ id: 20, refs: [101, 102], tags: { highway: "footway", name: "Surface" } }],
    );
    const conflation = { propertyKeys: ["name"], attachNetwork: false };
    const candidate = discoverConflationCandidates(base, patch, conflation).candidates.find(
      (item) => item.entityType === "way",
    );

    expect(candidate).toMatchObject({ targetId: 10, status: "blocked" });
    expect(candidate?.reasons).toContain("grade-conflict");
    const result = await merge(base, patch, { directMerge: true, conflation }, silent);
    expect(result.ways.ids.has(20)).toBe(true);
  });
});

describe("safe fuzzy topology gates", () => {
  it("requires review before attaching drivable living-street geometry", async () => {
    const base = createOsm(
      "base",
      [
        { id: 1, lon: 0, lat: 0 },
        { id: 2, lon: -0.001, lat: 0 },
      ],
      [{ id: 10, refs: [2, 1], tags: { highway: "living_street" } }],
    );
    const patch = createOsm(
      "patch",
      [
        { id: 101, lon: 0.000005, lat: 0 },
        { id: 102, lon: 0.001, lat: 0 },
      ],
      [{ id: 20, refs: [101, 102], tags: { highway: "living_street" } }],
    );
    const candidate = discoverConflationCandidates(base, patch, attachmentOptions).candidates.find(
      (item) => item.sourceId === 101,
    );
    expect(candidate).toMatchObject({
      status: "review",
      networkAttachment: {
        status: "review",
        reasons: ["drivable-network"],
      },
      evidence: {
        sourceRoutingFamilies: ["motor-road"],
        targetRoutingFamilies: ["motor-road"],
      },
    });

    const result = await merge(
      base,
      patch,
      { directMerge: true, conflation: attachmentOptions },
      silent,
    );
    expect(result.ways.getById(20)?.refs).toEqual([101, 102]);
    expect(result.nodes.ids.has(101)).toBe(true);
  });

  it("blocks conflicting node grade and access context before network attachment", () => {
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
        { id: 101, lon: 0.000005, lat: 0, tags: { layer: "-1", access: "private" } },
        { id: 102, lon: 0.001, lat: 0 },
      ],
      [{ id: 20, refs: [101, 102], tags: { highway: "footway" } }],
    );
    const candidate = discoverConflationCandidates(base, patch, attachmentOptions).candidates.find(
      (item) => item.sourceId === 101,
    );
    expect(candidate?.networkAttachment?.status).toBe("blocked");
    expect(candidate?.networkAttachment?.reasons).toEqual(
      expect.arrayContaining(["grade-conflict", "routing-family-conflict"]),
    );
  });

  it("never auto-attaches barrier or floor nodes even when their contexts agree", () => {
    const base = createOsm(
      "base",
      [
        { id: 1, lon: 0, lat: 0, tags: { barrier: "gate", level: "1" } },
        { id: 2, lon: -0.001, lat: 0 },
      ],
      [{ id: 10, refs: [2, 1], tags: { highway: "footway" } }],
    );
    const patch = createOsm(
      "patch",
      [
        { id: 101, lon: 0.000005, lat: 0, tags: { barrier: "gate", level: "1" } },
        { id: 102, lon: 0.001, lat: 0 },
      ],
      [{ id: 20, refs: [101, 102], tags: { highway: "footway" } }],
    );
    const candidate = discoverConflationCandidates(base, patch, attachmentOptions).candidates.find(
      (item) => item.sourceId === 101,
    );
    expect(candidate?.networkAttachment).toMatchObject({
      status: "review",
      reasons: ["node-context-conflict"],
    });
  });

  it("blocks incompatible crossing and kerb node context but permits exact context", () => {
    const base = createOsm(
      "base",
      [
        {
          id: 1,
          lon: 0,
          lat: 0,
          tags: { highway: "crossing", crossing: "marked", kerb: "lowered" },
        },
        { id: 2, lon: -0.001, lat: 0 },
      ],
      [{ id: 10, refs: [2, 1], tags: { highway: "footway" } }],
    );
    const patch = createOsm(
      "patch",
      [
        {
          id: 101,
          lon: 0.000005,
          lat: 0,
          tags: { highway: "crossing", crossing: "unmarked", kerb: "raised" },
        },
        { id: 102, lon: 0.001, lat: 0 },
      ],
      [{ id: 20, refs: [101, 102], tags: { highway: "footway" } }],
    );
    const conflict = discoverConflationCandidates(base, patch, attachmentOptions).candidates.find(
      (item) => item.sourceId === 101,
    );
    expect(conflict?.networkAttachment).toMatchObject({
      status: "blocked",
      reasons: ["routing-family-conflict"],
    });

    const exactPatch = createOsm(
      "exact-patch",
      [
        {
          id: 101,
          lon: 0.000005,
          lat: 0,
          tags: { highway: "crossing", crossing: "marked", kerb: "lowered" },
        },
        { id: 102, lon: 0.001, lat: 0 },
      ],
      [{ id: 20, refs: [101, 102], tags: { highway: "footway" } }],
    );
    const exact = discoverConflationCandidates(base, exactPatch, attachmentOptions).candidates.find(
      (item) => item.sourceId === 101,
    );
    expect(exact?.networkAttachment).toEqual({ status: "automatic", reasons: [] });
  });

  it("blocks grade conflicts and reviews perpendicular attachments", () => {
    const base = createOsm(
      "base",
      [
        { id: 1, lon: 0, lat: 0 },
        { id: 2, lon: 0, lat: -0.001 },
      ],
      [
        {
          id: 10,
          refs: [2, 1],
          tags: { highway: "footway", tunnel: "yes", layer: "-1" },
        },
      ],
    );
    const patch = createOsm(
      "patch",
      [
        { id: 101, lon: 0.000005, lat: 0 },
        { id: 102, lon: 0.001, lat: 0 },
      ],
      [{ id: 20, refs: [101, 102], tags: { highway: "footway" } }],
    );
    const gradeConflict = discoverConflationCandidates(
      base,
      patch,
      attachmentOptions,
    ).candidates.find((candidate) => candidate.sourceId === 101);
    expect(gradeConflict?.status).toBe("blocked");
    expect(gradeConflict?.reasons).toContain("grade-conflict");

    const surfaceBase = createOsm(
      "surface",
      [
        { id: 1, lon: 0, lat: 0 },
        { id: 2, lon: 0, lat: -0.001 },
      ],
      [{ id: 10, refs: [2, 1], tags: { highway: "footway" } }],
    );
    const perpendicular = discoverConflationCandidates(
      surfaceBase,
      patch,
      attachmentOptions,
    ).candidates.find((candidate) => candidate.sourceId === 101);
    expect(perpendicular?.status).toBe("review");
    expect(perpendicular?.reasons).toContain("bearing-mismatch");
  });

  it("blocks patch-way collapse and relation-member attachment", () => {
    const base = createOsm(
      "base",
      [
        { id: 1, lon: 0, lat: 0 },
        { id: 2, lon: -0.001, lat: 0 },
      ],
      [{ id: 10, refs: [2, 1], tags: { highway: "footway" } }],
    );
    const collapsePatch = createOsm(
      "collapse",
      [{ id: 101, lon: 0.000005, lat: 0 }],
      [{ id: 20, refs: [101, 1], tags: { highway: "footway" } }],
    );
    const collapse = discoverConflationCandidates(
      base,
      collapsePatch,
      attachmentOptions,
    ).candidates.find((candidate) => candidate.sourceId === 101);
    expect(collapse?.status).toBe("blocked");
    expect(collapse?.reasons).toContain("would-collapse-way");

    const relationPatch = createOsm(
      "relation",
      [
        { id: 101, lon: 0.000005, lat: 0 },
        { id: 102, lon: 0.001, lat: 0 },
      ],
      [{ id: 20, refs: [101, 102], tags: { highway: "footway" } }],
      [
        {
          id: 30,
          members: [{ type: "node", ref: 101, role: "stop" }],
          tags: { type: "route" },
        },
      ],
    );
    const relation = discoverConflationCandidates(
      base,
      relationPatch,
      attachmentOptions,
    ).candidates.find((candidate) => candidate.sourceId === 101);
    expect(relation?.status).toBe("review");
    expect(relation?.reasons).toContain("relation-member");

    const restrictionPatch = createOsm(
      "restriction",
      [
        { id: 101, lon: 0.000005, lat: 0 },
        { id: 102, lon: 0.001, lat: 0 },
      ],
      [{ id: 20, refs: [101, 102], tags: { highway: "footway" } }],
      [
        {
          id: 31,
          members: [{ type: "node", ref: 101, role: "via" }],
          tags: { type: "restriction", restriction: "no_left_turn" },
        },
      ],
    );
    const restriction = discoverConflationCandidates(
      base,
      restrictionPatch,
      attachmentOptions,
    ).candidates.find((candidate) => candidate.sourceId === 101);
    expect(restriction?.status).toBe("blocked");
    expect(restriction?.reasons).toContain("relation-member");
  });

  it("reports one-to-many way chains as unsupported and leaves them in the direct merge", async () => {
    const base = createOsm(
      "base",
      [
        { id: 1, lon: 0, lat: 0 },
        { id: 2, lon: 0.001, lat: 0 },
        { id: 3, lon: 0.002, lat: 0 },
      ],
      [
        { id: 10, refs: [1, 2], tags: { highway: "footway" } },
        { id: 11, refs: [2, 3], tags: { highway: "footway" } },
      ],
    );
    const patch = createOsm(
      "patch",
      [
        { id: 101, lon: 0, lat: 0.000004 },
        { id: 102, lon: 0.001, lat: 0.000004 },
        { id: 103, lon: 0.002, lat: 0.000004 },
      ],
      [
        {
          id: 20,
          refs: [101, 102, 103],
          tags: { highway: "footway", name: "Imported" },
        },
      ],
    );
    const options = { propertyKeys: ["name"], attachNetwork: false };
    const unsupported = discoverConflationCandidates(base, patch, options).candidates.find(
      (candidate) => candidate.entityType === "way",
    );
    expect(unsupported).toMatchObject({ status: "unmatched", targetId: null });
    expect(unsupported?.reasons).toContain("unsupported-way-chain");

    const result = await merge(base, patch, { directMerge: true, conflation: options }, silent);
    expect(result.ways.getById(20)?.refs).toEqual([101, 102, 103]);
  });

  it("generates equivalent fuzzy-only and cumulative changesets from canonical discovery", () => {
    const base = createOsm("base", [{ id: 1, lon: 0, lat: 0, tags: { name: "Old" } }]);
    const patch = createOsm("patch", [
      { id: 101, lon: 0.000005, lat: 0, tags: { name: "Imported" } },
    ]);
    const conflation = { propertyKeys: ["name"], attachNetwork: false };
    const discovery = discoverConflationCandidates(base, patch, conflation);

    const cumulative = applyChangesetToOsm(
      generateConflationChangeset(base, patch, { directMerge: true, conflation }, [], discovery),
    );
    const direct = applyChangesetToOsm(generateChangeset(base, patch, { directMerge: true }));
    const fuzzyOnly = applyChangesetToOsm(
      generateConflationApplicationChangeset(direct, patch, discovery, base),
    );
    expect(fuzzyOnly.nodes.getById(1)?.tags).toEqual(cumulative.nodes.getById(1)?.tags);
    expect(fuzzyOnly.nodes.getById(101)).toEqual(cumulative.nodes.getById(101));
  });

  it("enforces the protected-base assertion inside the fuzzy-only generator", () => {
    const originalBase = createOsm("base", [{ id: 1, lon: 0, lat: 0 }]);
    const malformedBaseline = createOsm("base", []);
    const patch = createOsm("patch", []);
    const discovery = discoverConflationCandidates(originalBase, patch, {
      propertyKeys: ["name"],
      attachNetwork: false,
    });

    expect(() =>
      generateConflationApplicationChangeset(malformedBaseline, patch, discovery, originalBase),
    ).toThrow("Conflation changed protected base topology");
  });

  it("applies and validates the cumulative result before returning its changeset", () => {
    const base = createOsm("base", []);
    const patch = createOsm(
      "patch",
      [{ id: 101, lon: 0, lat: 0 }],
      [{ id: 20, refs: [101, 999], tags: { highway: "footway", name: "Imported" } }],
    );

    expect(() =>
      generateConflationChangeset(base, patch, {
        directMerge: true,
        conflation: { propertyKeys: ["name"], attachNetwork: false },
      }),
    ).toThrow("way 20 references missing node 999");
  });
});
