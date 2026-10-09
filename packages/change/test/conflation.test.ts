import { Osm } from "@osmix/core";
import type { OsmNode, OsmRelation, OsmWay } from "@osmix/types";
import { describe, expect, it, vi } from "vitest";

import { discoverConflationCandidates, summarizeConflationCandidates } from "../src/conflation.ts";
import { merge } from "../src/merge.ts";
import { applyPlan, planMerge } from "../src/plan/plan.ts";
import type { OsmConflationOptions } from "../src/types.ts";
import { withMatchingDecisions } from "./helpers/plan.ts";

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
  it("drops a connected imported node once nothing else uses it", async () => {
    const base = createOsm(
      "base",
      [
        { id: 1, lon: 0, lat: 0 },
        { id: 2, lon: -0.001, lat: 0 },
      ],
      [{ id: 10, refs: [2, 1], tags: { highway: "footway" } }],
    );
    const importWith = (source: Partial<OsmNode>, extraWays: OsmWay[] = []) =>
      createOsm(
        "patch",
        [
          { id: 101, lon: 0.000005, lat: 0, ...source },
          { id: 102, lon: 0.001, lat: 0 },
          { id: 103, lon: 0.000005, lat: 0.001 },
        ],
        [{ id: 20, refs: [101, 102], tags: { highway: "footway" } }, ...extraWays],
      );
    const mergeWith = (patch: Osm) =>
      merge(
        base,
        patch,
        { mergeIdenticalPoints: false, createIntersections: false, matching: attachmentOptions },
        silent,
      );

    const untagged = await mergeWith(importWith({}));
    expect(untagged.ways.getById(20)?.refs).toEqual([1, 102]);
    expect(untagged.nodes.ids.has(101)).toBe(false);

    // A tagged point's values merge into the base point, so it goes too.
    const tagged = await mergeWith(importWith({ tags: { note: "surveyed" } }));
    expect(tagged.ways.getById(20)?.refs).toEqual([1, 102]);
    expect(tagged.nodes.ids.has(101)).toBe(false);
    expect(tagged.nodes.getById(1)?.tags).toEqual({ note: "surveyed" });

    // A wall is not a routing way, so the connection does not rewrite it and 101 stays in use.
    const shared = await mergeWith(
      importWith({}, [{ id: 21, refs: [101, 103], tags: { barrier: "wall" } }]),
    );
    expect(shared.ways.getById(20)?.refs).toEqual([1, 102]);
    expect(shared.ways.getById(21)?.refs).toEqual([101, 103]);
    expect(shared.nodes.ids.has(101)).toBe(true);
  });

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

    const buildIndexes = vi.spyOn(Osm.prototype, "buildIndexes");
    let result!: Osm;
    try {
      result = await merge(
        base,
        patch,
        { mergeIdenticalPoints: false, createIntersections: false, matching: attachmentOptions },
        silent,
      );
      // Plan once, build once: the planned state is never materialized in between.
      expect(buildIndexes).toHaveBeenCalledTimes(1);
    } finally {
      buildIndexes.mockRestore();
    }
    expect(result.nodes.getById(1)).toMatchObject({ lon: 0, lat: 0 });
    // The connection left untagged 101 unused, so it is dropped.
    expect(result.nodes.ids.has(101)).toBe(false);
    expect(result.ways.getById(10)?.refs).toEqual([2, 1]);
    expect(result.ways.getById(20)?.refs).toEqual([1, 102]);
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

  it("keeps decision summaries lightweight", () => {
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

    const accepted = [{ candidateId: "node:101->1", action: "accept" as const }];
    expect(summarizeConflationCandidates(discovery.candidates, accepted)).toMatchObject({
      total: 1,
      accepted: 1,
      automatic: 0,
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

  it("reports decisions naming no proposal instead of applying them", async () => {
    const base = createOsm("base", [{ id: 1, lon: 0, lat: 0, tags: { name: "Base" } }]);
    const patch = createOsm("patch", [{ id: 101, lon: 0.000005, lat: 0, tags: { name: "Patch" } }]);
    const plan = planMerge(
      base,
      patch,
      {
        mergeIdenticalPoints: false,
        createIntersections: false,
        matching: { propertyKeys: ["name"], attachNetwork: false },
        decisions: [{ proposalId: "copy:nstale>n1", action: "accept" }],
      },
      silent,
    );
    expect(plan.staleDecisions).toEqual(["copy:nstale>n1"]);
    const undecided = planMerge(
      base,
      patch,
      {
        mergeIdenticalPoints: false,
        createIntersections: false,
        matching: { propertyKeys: ["name"], attachNetwork: false },
      },
      silent,
    );
    expect(applyPlan(plan).osm.contentHash()).toBe(applyPlan(undecided).osm.contentHash());
  });
});

describe("safe fuzzy property transfer", () => {
  it("overwrites only selected properties and retains the imported point geometry", async () => {
    const base = createOsm("base", [
      { id: 1, lon: 0, lat: 0, tags: { amenity: "cafe", name: "Old", operator: "Base operator" } },
    ]);
    const patch = createOsm("patch", [
      {
        id: 101,
        lon: 0.000005,
        lat: 0,
        tags: {
          amenity: "cafe",
          name: "Imported",
          operator: "Imported operator",
          source: "survey",
        },
      },
    ]);

    const result = await merge(
      base,
      patch,
      {
        mergeIdenticalPoints: false,
        createIntersections: false,
        matching: { propertyKeys: ["name", "missing"], attachNetwork: false },
      },
      silent,
    );
    expect(result.nodes.getById(1)?.tags).toEqual({
      amenity: "cafe",
      name: "Imported",
      operator: "Base operator",
    });
    expect(result.nodes.getById(101)?.tags).toEqual({
      amenity: "cafe",
      name: "Imported",
      operator: "Imported operator",
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
    };
    const result = await merge(
      base,
      patch,
      withMatchingDecisions(
        base,
        patch,
        { mergeIdenticalPoints: false, createIntersections: false, matching: conflation },
        [{ candidateId: "node:101->1", action: "accept" }],
      ),
      silent,
    );
    expect(result.nodes.getById(1)?.tags).toEqual({ highway: "crossing" });
  });

  it("copies properties from reversed one-to-one ways without removing imported geometry", async () => {
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

    const result = await merge(
      base,
      patch,
      { mergeIdenticalPoints: false, createIntersections: false, matching: options },
      silent,
    );
    expect(result.ways.getById(10)?.refs).toEqual([1, 2]);
    expect(result.ways.getById(10)?.tags?.["name"]).toBe("Imported");
    expect(result.ways.getById(20)).toEqual(patch.ways.getById(20));
    expect(result.nodes.getById(101)).toEqual(patch.nodes.getById(101));
    expect(result.nodes.getById(102)).toEqual(patch.nodes.getById(102));
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
      { createIntersections: false, matching: conflation },
      silent,
    );
    expect(result.nodes.getById(1)?.tags?.["ref"]).toBe("patch");
    // On identical geometry the ways reconcile first, and the imported surface wins (MP-X2).
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
    const result = await merge(
      base,
      patch,
      { mergeIdenticalPoints: false, createIntersections: false, matching: conflation },
      silent,
    );
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
    const result = await merge(
      base,
      patch,
      { mergeIdenticalPoints: false, createIntersections: false, matching: conflation },
      silent,
    );
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
    const result = await merge(
      base,
      patch,
      { mergeIdenticalPoints: false, createIntersections: false, matching: conflation },
      silent,
    );
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
    const result = await merge(
      base,
      patch,
      { mergeIdenticalPoints: false, createIntersections: false, matching: conflation },
      silent,
    );
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
    const result = await merge(
      base,
      patch,
      { mergeIdenticalPoints: false, createIntersections: false, matching: conflation },
      silent,
    );
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
    const result = await merge(
      base,
      patch,
      { mergeIdenticalPoints: false, createIntersections: false, matching: conflation },
      silent,
    );
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
      { mergeIdenticalPoints: false, createIntersections: false, matching: attachmentOptions },
      silent,
    );
    expect(result.ways.getById(20)?.refs).toEqual([101, 102]);
    expect(result.nodes.ids.has(101)).toBe(true);
  });

  it("waits on a connection that would change the base point's grade, not its access", () => {
    const base = createOsm(
      "base",
      [
        { id: 1, lon: 0, lat: 0 },
        { id: 2, lon: -0.001, lat: 0 },
      ],
      [{ id: 10, refs: [2, 1], tags: { highway: "footway" } }],
    );
    const patchWith = (tags: OsmNode["tags"]) =>
      createOsm(
        "patch",
        [
          { id: 101, lon: 0.000005, lat: 0, tags },
          { id: 102, lon: 0.001, lat: 0 },
        ],
        [{ id: 20, refs: [101, 102], tags: { highway: "footway" } }],
      );
    const attachment = (tags: OsmNode["tags"]) =>
      discoverConflationCandidates(base, patchWith(tags), attachmentOptions).candidates.find(
        (item) => item.sourceId === 101,
      )?.networkAttachment;
    expect(attachment({ layer: "-1", access: "private" })).toEqual({
      status: "review",
      reasons: ["grade-change"],
    });
    expect(attachment({ access: "private", barrier: "gate" })).toEqual({
      status: "automatic",
      reasons: [],
    });
  });

  it("lets a connected kerb ramp's values win, as an identical-point merge does", async () => {
    const base = createOsm(
      "base",
      [
        { id: 1, lon: 0, lat: 0, tags: { barrier: "kerb", crossing: "marked", kerb: "raised" } },
        { id: 2, lon: -0.001, lat: 0 },
      ],
      [{ id: 10, refs: [2, 1], tags: { highway: "footway" } }],
    );
    const ramp = { barrier: "kerb", kerb: "lowered", tactile_paving: "yes" };
    const patch = createOsm(
      "patch",
      [
        { id: 101, lon: 0.000005, lat: 0, tags: ramp },
        { id: 102, lon: 0.001, lat: 0 },
      ],
      [{ id: 20, refs: [101, 102], tags: { highway: "footway" } }],
    );
    const candidate = discoverConflationCandidates(base, patch, attachmentOptions).candidates.find(
      (item) => item.sourceId === 101,
    );
    expect(candidate?.networkAttachment).toEqual({ status: "automatic", reasons: [] });
    const result = await merge(
      base,
      patch,
      { mergeIdenticalPoints: false, createIntersections: false, matching: attachmentOptions },
      silent,
    );
    expect(result.ways.getById(20)?.refs).toEqual([1, 102]);
    expect(result.nodes.ids.has(101)).toBe(false);
    expect(result.nodes.getById(1)?.tags).toEqual({ ...base.nodes.getById(1)?.tags, ...ramp });
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
    // A way's end meets the base path at a corner: no bearing check (MP-M1).
    const corner = discoverConflationCandidates(
      surfaceBase,
      patch,
      attachmentOptions,
    ).candidates.find((candidate) => candidate.sourceId === 101);
    expect(corner?.reasons).not.toContain("bearing-mismatch");
    expect(corner?.evidence.bearingDifferenceDegrees).toBeUndefined();
    // A point along a way that crosses the base path at right angles does need review.
    const throughPatch = createOsm(
      "through",
      [
        { id: 100, lon: -0.001, lat: 0 },
        { id: 101, lon: 0.000005, lat: 0 },
        { id: 102, lon: 0.001, lat: 0 },
      ],
      [{ id: 20, refs: [100, 101, 102], tags: { highway: "footway" } }],
    );
    const perpendicular = discoverConflationCandidates(
      surfaceBase,
      throughPatch,
      attachmentOptions,
    ).candidates.find((candidate) => candidate.sourceId === 101);
    expect(perpendicular?.status).toBe("review");
    expect(perpendicular?.reasons).toContain("bearing-mismatch");
  });

  it("blocks attaching into a junction that final validation rejects for mixed grades", () => {
    // Node 1 ends a surface footway and sits inside a level=1 footway: a surface way satisfies the
    // pairwise check, but the whole junction is one final validation rejects (issue K1).
    const patch = createOsm(
      "patch",
      [
        { id: 101, lon: -0.000005, lat: 0 },
        { id: 102, lon: -0.001, lat: 0 },
      ],
      [{ id: 20, refs: [101, 102], tags: { highway: "footway" } }],
    );
    const mixed = createOsm(
      "mixed",
      [
        { id: 1, lon: 0, lat: 0 },
        { id: 2, lon: 0.001, lat: 0 },
        { id: 3, lon: 0, lat: -0.001 },
        { id: 4, lon: 0, lat: 0.001 },
      ],
      [
        { id: 10, refs: [1, 2], tags: { highway: "footway" } },
        { id: 11, refs: [3, 1, 4], tags: { highway: "footway", level: "1" } },
      ],
    );
    const blocked = discoverConflationCandidates(mixed, patch, attachmentOptions).candidates.find(
      (candidate) => candidate.sourceId === 101,
    );
    expect(blocked?.networkAttachment?.status).toBe("blocked");
    expect(blocked?.networkAttachment?.reasons).toContain("grade-conflict");

    // A portal is fine: the surface way passes through, the level=1 way ends there, and another
    // surface way continues from it, so the junction passes final validation.
    const portal = createOsm(
      "portal",
      [
        { id: 1, lon: 0, lat: 0 },
        { id: 2, lon: 0.001, lat: 0 },
        { id: 3, lon: 0, lat: -0.001 },
        { id: 4, lon: 0, lat: 0.001 },
        { id: 5, lon: 0.001, lat: 0.001 },
      ],
      [
        { id: 10, refs: [3, 1, 4], tags: { highway: "footway" } },
        { id: 11, refs: [1, 2], tags: { highway: "footway", level: "1" } },
        { id: 12, refs: [1, 5], tags: { highway: "footway" } },
      ],
    );
    const allowed = discoverConflationCandidates(portal, patch, attachmentOptions).candidates.find(
      (candidate) => candidate.sourceId === 101,
    );
    expect(allowed?.networkAttachment?.reasons).not.toContain("grade-conflict");
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

  it("reviews a connection that keeps a patch restriction intact and moves its via node", async () => {
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
        { id: 103, lon: 0.000005, lat: 0.001 },
      ],
      [
        { id: 20, refs: [101, 102], tags: { highway: "footway" } },
        { id: 21, refs: [101, 103], tags: { highway: "footway" } },
      ],
      [
        {
          id: 31,
          members: [
            { type: "way", ref: 20, role: "from" },
            { type: "node", ref: 101, role: "via" },
            { type: "way", ref: 21, role: "to" },
          ],
          tags: { type: "restriction", restriction: "no_left_turn" },
        },
      ],
    );
    const candidate = discoverConflationCandidates(base, patch, attachmentOptions).candidates.find(
      (item) => item.sourceId === 101,
    );
    // Previously any restriction membership blocked the connection outright.
    expect(candidate?.networkAttachment?.status).toBe("review");
    expect(candidate?.networkAttachment?.reasons).toContain("relation-member");

    const result = await merge(
      base,
      patch,
      withMatchingDecisions(
        base,
        patch,
        { mergeIdenticalPoints: false, createIntersections: false, matching: attachmentOptions },
        [{ candidateId: candidate!.id, action: "accept", attachNetwork: true }],
      ),
      silent,
    );
    expect(result.ways.getById(20)?.refs).toEqual([1, 102]);
    expect(result.relations.getById(31)?.members[1]).toEqual({ type: "node", ref: 1, role: "via" });
    // The via member moved, so nothing uses the imported point any more.
    expect(result.nodes.ids.has(101)).toBe(false);
  });

  it("blocks copying tags onto a node in a junction with grade-separated ways (G5)", () => {
    const base = createOsm(
      "base",
      [
        { id: 1, lon: 0, lat: 0 },
        { id: 2, lon: 0.001, lat: 0 },
        { id: 3, lon: 0, lat: -0.001 },
        { id: 4, lon: 0, lat: 0.001 },
      ],
      [
        { id: 10, refs: [1, 2], tags: { highway: "footway" } },
        { id: 11, refs: [3, 1, 4], tags: { highway: "footway", level: "1" } },
      ],
    );
    const patch = createOsm(
      "patch",
      [
        { id: 101, lon: -0.000005, lat: 0, tags: { tactile_paving: "yes" } },
        { id: 102, lon: -0.001, lat: 0 },
      ],
      [{ id: 20, refs: [101, 102], tags: { highway: "footway" } }],
    );
    const candidate = discoverConflationCandidates(base, patch, {
      propertyKeys: ["tactile_paving"],
      attachNetwork: false,
    }).candidates.find((item) => item.sourceId === 101);
    // Previously one compatible base way was enough, so the copy was automatic.
    expect(candidate?.propertyTransfer.status).toBe("blocked");
    expect(candidate?.propertyTransfer.reasons).toContain("grade-conflict");
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

    const result = await merge(
      base,
      patch,
      { mergeIdenticalPoints: false, createIntersections: false, matching: options },
      silent,
    );
    expect(result.ways.getById(20)?.refs).toEqual([101, 102, 103]);
  });

  it("validates the planned result before building it", async () => {
    const base = createOsm("base", []);
    const patch = createOsm(
      "patch",
      [{ id: 101, lon: 0, lat: 0 }],
      [{ id: 20, refs: [101, 999], tags: { highway: "footway", name: "Imported" } }],
    );

    await expect(
      merge(
        base,
        patch,
        {
          mergeIdenticalPoints: false,
          createIntersections: false,
          matching: { propertyKeys: ["name"], attachNetwork: false },
        },
        silent,
      ),
    ).rejects.toThrow("way 20 references missing node 999");
  });
});
