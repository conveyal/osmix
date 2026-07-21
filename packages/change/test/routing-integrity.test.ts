import { Osm } from "@osmix/core";
import type { OsmNode, OsmRelation, OsmWay } from "@osmix/types";
import { describe, expect, it } from "vitest";

import { applyChangesetToOsm } from "../src/apply-changeset.ts";
import { generateChangeset } from "../src/generate-changeset.ts";
import { merge } from "../src/merge.ts";

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

describe("routing-safe merge reconciliation", () => {
  it("keeps an empty-patch merge as an identity operation", async () => {
    const base = createOsm(
      "base",
      [
        { id: 1, lon: 0, lat: 0 },
        { id: 2, lon: 0.000005, lat: 0 },
      ],
      [{ id: 10, refs: [1, 2], tags: { highway: "residential" } }],
    );
    const patch = createOsm("empty", []);

    const result = await merge(
      base,
      patch,
      { directMerge: true, deduplicateNodes: true, deduplicateWays: true },
      silent,
    );

    expect([...result.nodes].map((node) => node.id)).toEqual([1, 2]);
    expect(result.ways.getById(10)?.refs).toEqual([1, 2]);
  });

  it("does not reconcile nearby or grade-separated nodes", async () => {
    const base = createOsm(
      "base",
      [
        { id: 1, lon: 0, lat: 0 },
        { id: 2, lon: 0.01, lat: 0 },
      ],
      [
        {
          id: 10,
          refs: [1, 2],
          tags: { highway: "secondary", layer: "-1", tunnel: "yes" },
        },
      ],
    );
    const patch = createOsm(
      "patch",
      [
        { id: 101, lon: 0, lat: 0 },
        { id: 102, lon: 0.000005, lat: 0 },
        { id: 103, lon: 0.01, lat: 0.01 },
      ],
      [
        { id: 20, refs: [101, 103], tags: { highway: "secondary" } },
        { id: 21, refs: [102, 103], tags: { highway: "residential" } },
      ],
    );

    const result = await merge(base, patch, { directMerge: true, deduplicateNodes: true }, silent);

    expect(result.nodes.ids.has(101)).toBe(true);
    expect(result.nodes.ids.has(102)).toBe(true);
    expect(result.ways.getById(20)?.refs).toEqual([101, 103]);
    expect(result.ways.getById(21)?.refs).toEqual([102, 103]);
  });

  it("rejects conflicting node tags and preserves non-conflicting descriptive tags", async () => {
    const base = createOsm(
      "base",
      [
        { id: 1, lon: 0, lat: 0, tags: { amenity: "cafe" } },
        { id: 2, lon: -1, lat: 0 },
        { id: 3, lon: 1, lat: 0 },
      ],
      [{ id: 10, refs: [2, 1], tags: { highway: "residential" } }],
    );
    const patch = createOsm(
      "patch",
      [
        { id: 101, lon: 0, lat: 0, tags: { amenity: "school" } },
        { id: 102, lon: 1, lat: 0, tags: { name: "Patch endpoint" } },
        { id: 103, lon: 0, lat: 1 },
      ],
      [
        { id: 20, refs: [101, 103], tags: { highway: "residential" } },
        { id: 21, refs: [102, 103], tags: { highway: "residential" } },
      ],
    );

    const result = await merge(base, patch, { directMerge: true, deduplicateNodes: true }, silent);

    expect(result.nodes.ids.has(101)).toBe(true);
    expect(result.ways.getById(20)?.refs).toEqual([101, 103]);
    expect(result.nodes.ids.has(102)).toBe(false);
    expect(result.nodes.getById(3)?.tags).toEqual({ name: "Patch endpoint" });
    expect(result.ways.getById(21)?.refs).toEqual([3, 103]);
  });

  it("rejects a candidate when any incident way has incompatible context", async () => {
    const base = createOsm(
      "base",
      [
        { id: 1, lon: 0, lat: 0 },
        { id: 2, lon: -1, lat: 0 },
        { id: 3, lon: 1, lat: 0 },
      ],
      [
        { id: 10, refs: [2, 1], tags: { highway: "primary" } },
        {
          id: 11,
          refs: [1, 3],
          tags: { highway: "primary", layer: "-1", tunnel: "yes" },
        },
      ],
    );
    const patch = createOsm(
      "patch",
      [
        { id: 101, lon: 0, lat: 0 },
        { id: 102, lon: 0, lat: 1 },
      ],
      [{ id: 20, refs: [101, 102], tags: { highway: "secondary" } }],
    );

    const result = await merge(base, patch, { directMerge: true, deduplicateNodes: true }, silent);

    expect(result.nodes.ids.has(101)).toBe(true);
    expect(result.ways.getById(20)?.refs).toEqual([101, 102]);
  });

  it("keeps same-ID patch nodes authoritative instead of deleting a base identity", async () => {
    const base = createOsm(
      "base",
      [
        { id: 1, lon: 0, lat: 0 },
        { id: 2, lon: 1, lat: 0 },
        { id: 3, lon: 0, lat: 1 },
      ],
      [{ id: 10, refs: [1, 3], tags: { highway: "residential" } }],
    );
    const patch = createOsm("patch", [{ id: 1, lon: 1, lat: 0 }]);

    const result = await merge(base, patch, { directMerge: true, deduplicateNodes: true }, silent);

    expect(result.nodes.ids.has(1)).toBe(true);
    expect(result.nodes.ids.has(2)).toBe(true);
    expect(result.nodes.getById(1)).toMatchObject({ lon: 1, lat: 0 });
    expect(result.ways.getById(10)?.refs).toEqual([1, 3]);
  });

  it("does not collapse a routable patch way to one distinct base node", async () => {
    const base = createOsm("base", [{ id: 1, lon: 0, lat: 0 }]);
    const patch = createOsm(
      "patch",
      [
        { id: 101, lon: 0, lat: 0 },
        { id: 102, lon: 0, lat: 0 },
      ],
      [{ id: 20, refs: [101, 102], tags: { highway: "service" } }],
    );

    const result = await merge(base, patch, { directMerge: true, deduplicateNodes: true }, silent);

    expect(result.nodes.ids.has(101)).toBe(true);
    expect(result.nodes.ids.has(102)).toBe(true);
    expect(result.ways.getById(20)?.refs).toEqual([101, 102]);
  });

  it("does not reconcile ways with conflicting routing tags", async () => {
    const base = createOsm(
      "base",
      [
        { id: 1, lon: 0, lat: 0 },
        { id: 2, lon: 1, lat: 0 },
      ],
      [{ id: 10, refs: [1, 2], tags: { highway: "residential" } }],
    );
    const patch = createOsm(
      "patch",
      [],
      [{ id: 20, refs: [1, 2], tags: { highway: "residential", oneway: "yes" } }],
    );

    const result = await merge(base, patch, { directMerge: true, deduplicateWays: true }, silent);

    expect(result.ways.ids.has(10)).toBe(true);
    expect(result.ways.ids.has(20)).toBe(true);
  });

  it("does not reconcile ways with conditional access semantics", async () => {
    const base = createOsm(
      "base",
      [
        { id: 1, lon: 0, lat: 0 },
        { id: 2, lon: 1, lat: 0 },
      ],
      [{ id: 10, refs: [1, 2], tags: { highway: "residential" } }],
    );
    const patch = createOsm(
      "patch",
      [],
      [
        {
          id: 20,
          refs: [1, 2],
          tags: {
            "access:conditional": "no @ (Mo-Fr 07:00-09:00)",
            highway: "residential",
            name: "School Street",
          },
        },
      ],
    );

    const result = await merge(base, patch, { directMerge: true, deduplicateWays: true }, silent);

    expect(result.ways.ids.has(10)).toBe(true);
    expect(result.ways.ids.has(20)).toBe(true);
    expect(result.ways.getById(10)?.tags).toEqual({ highway: "residential" });
  });

  it("copies only non-conflicting descriptive tags when ways reconcile", async () => {
    const base = createOsm(
      "base",
      [
        { id: 1, lon: 0, lat: 0 },
        { id: 2, lon: 1, lat: 0 },
      ],
      [{ id: 10, refs: [1, 2], tags: { highway: "residential" } }],
    );
    const patch = createOsm(
      "patch",
      [],
      [{ id: 20, refs: [1, 2], tags: { highway: "residential", name: "Connector" } }],
    );

    const result = await merge(base, patch, { directMerge: true, deduplicateWays: true }, silent);

    expect(result.ways.ids.has(20)).toBe(false);
    expect(result.ways.getById(10)?.tags).toEqual({
      highway: "residential",
      name: "Connector",
    });
  });

  it("rejects patch dangling refs even when they already exist in the patch", async () => {
    const base = createOsm("base", []);
    const patch = createOsm(
      "patch",
      [{ id: 101, lon: 0, lat: 0 }],
      [{ id: 20, refs: [101, 999], tags: { highway: "service" } }],
    );

    await expect(merge(base, patch, { directMerge: true }, silent)).rejects.toThrow(
      "way 20 references missing node 999",
    );
  });

  it("rejects a new patch restriction that is detached in the merged network", async () => {
    const base = createOsm(
      "base",
      [
        { id: 1, lon: 0, lat: 0 },
        { id: 2, lon: 1, lat: 0 },
        { id: 3, lon: 2, lat: 0 },
        { id: 4, lon: 3, lat: 0 },
      ],
      [
        { id: 10, refs: [1, 2], tags: { highway: "primary" } },
        { id: 20, refs: [3, 4], tags: { highway: "primary" } },
      ],
    );
    const patch = createOsm(
      "patch",
      [],
      [],
      [
        {
          id: 100,
          tags: { type: "restriction", restriction: "no_left_turn" },
          members: [
            { type: "way", ref: 10, role: "from" },
            { type: "node", ref: 2, role: "via" },
            { type: "way", ref: 20, role: "to" },
          ],
        },
      ],
    );

    await expect(merge(base, patch, { directMerge: true }, silent)).rejects.toThrow(
      "restriction 100 via node 2 is detached",
    );
  });

  it("rewrites pending restriction via-node members with reconciled patch nodes", async () => {
    const base = createOsm(
      "base",
      [
        { id: 1, lon: 0, lat: 0 },
        { id: 2, lon: -1, lat: 0 },
        { id: 3, lon: 1, lat: 0 },
      ],
      [{ id: 20, refs: [1, 3], tags: { highway: "primary" } }],
    );
    const patch = createOsm(
      "patch",
      [
        { id: 101, lon: 0, lat: 0 },
        { id: 102, lon: -1, lat: 0 },
      ],
      [{ id: 30, refs: [102, 101], tags: { highway: "primary" } }],
      [
        {
          id: 100,
          tags: { type: "restriction", restriction: "no_left_turn" },
          members: [
            { type: "way", ref: 30, role: "from" },
            { type: "node", ref: 101, role: "via" },
            { type: "way", ref: 20, role: "to" },
          ],
        },
      ],
    );

    const result = await merge(base, patch, { directMerge: true, deduplicateNodes: true }, silent);

    expect(result.ways.getById(30)?.refs).toEqual([2, 1]);
    expect(result.relations.getById(100)?.members[1]).toEqual({
      type: "node",
      ref: 1,
      role: "via",
    });
  });

  it("rejects same-ID changes that detach a valid restriction via node", async () => {
    const base = createOsm(
      "base",
      [
        { id: 1, lon: 0, lat: 0 },
        { id: 2, lon: 1, lat: 0 },
        { id: 3, lon: 2, lat: 0 },
        { id: 4, lon: 1, lat: 1 },
      ],
      [
        { id: 10, refs: [1, 2], tags: { highway: "primary" } },
        { id: 20, refs: [2, 3], tags: { highway: "primary" } },
      ],
      [
        {
          id: 100,
          tags: { type: "restriction", restriction: "no_left_turn" },
          members: [
            { type: "way", ref: 10, role: "from" },
            { type: "node", ref: 2, role: "via" },
            { type: "way", ref: 20, role: "to" },
          ],
        },
      ],
    );
    const patch = createOsm(
      "patch",
      [
        { id: 3, lon: 2, lat: 0 },
        { id: 4, lon: 1, lat: 1 },
      ],
      [{ id: 20, refs: [4, 3], tags: { highway: "primary" } }],
    );

    await expect(merge(base, patch, { directMerge: true }, silent)).rejects.toThrow(
      "restriction 100 via node 2 is detached",
    );
  });

  it("rejects newly connected highways with incompatible grade signatures", async () => {
    const base = createOsm(
      "base",
      [
        { id: 1, lon: 0, lat: 0 },
        { id: 2, lon: -1, lat: 0 },
        { id: 3, lon: 1, lat: 0 },
        { id: 4, lon: 0, lat: 1 },
      ],
      [
        { id: 10, refs: [2, 1, 4], tags: { highway: "primary" } },
        { id: 20, refs: [1, 3], tags: { highway: "primary" } },
      ],
    );
    const patch = createOsm(
      "patch",
      [],
      [
        {
          id: 20,
          refs: [1, 3],
          tags: { highway: "primary", layer: "-1", tunnel: "yes" },
        },
      ],
    );

    await expect(merge(base, patch, { directMerge: true }, silent)).rejects.toThrow(
      "node 1 newly connects grade-separated highways 10 and 20",
    );
  });

  it("allows a surface road endpoint to transition into a bridge endpoint", async () => {
    const base = createOsm(
      "base",
      [
        { id: 1, lon: 0, lat: 0 },
        { id: 2, lon: 1, lat: 0 },
      ],
      [{ id: 10, refs: [1, 2], tags: { highway: "primary" } }],
    );
    const patch = createOsm(
      "patch",
      [
        { id: 2, lon: 1, lat: 0 },
        { id: 3, lon: 2, lat: 0 },
      ],
      [
        {
          id: 20,
          refs: [2, 3],
          tags: { highway: "primary", bridge: "yes", layer: "1" },
        },
      ],
    );

    const result = await merge(base, patch, { directMerge: true }, silent);

    expect(result.ways.getById(20)?.refs).toEqual([2, 3]);
  });

  it("allows an interior way at a bridge portal with a same-grade endpoint continuation", async () => {
    const base = createOsm(
      "base",
      [
        { id: 1, lon: -1, lat: 0 },
        { id: 2, lon: 0, lat: 0 },
        { id: 3, lon: 1, lat: 0 },
        { id: 4, lon: 0, lat: 1 },
      ],
      [
        { id: 10, refs: [1, 2, 3], tags: { highway: "footway" } },
        { id: 30, refs: [2, 4], tags: { highway: "primary" } },
      ],
    );
    const patch = createOsm(
      "patch",
      [
        { id: 2, lon: 0, lat: 0 },
        { id: 5, lon: 0, lat: -1 },
      ],
      [
        {
          id: 20,
          refs: [2, 5],
          tags: { highway: "primary", bridge: "yes", layer: "1" },
        },
      ],
    );

    const result = await merge(base, patch, { directMerge: true }, silent);

    expect(result.ways.getById(10)?.refs).toEqual([1, 2, 3]);
    expect(result.ways.getById(20)?.refs).toEqual([2, 5]);
    expect(result.ways.getById(30)?.refs).toEqual([2, 4]);
  });

  it("rejects a surface endpoint spliced into an interior tunnel despite a tunnel continuation", async () => {
    const base = createOsm(
      "base",
      [
        { id: 1, lon: -1, lat: 0 },
        { id: 2, lon: 0, lat: 0 },
        { id: 3, lon: 1, lat: 0 },
        { id: 4, lon: 0, lat: 1 },
      ],
      [
        {
          id: 10,
          refs: [1, 2, 3],
          tags: { highway: "primary", layer: "-1", tunnel: "yes" },
        },
        {
          id: 30,
          refs: [2, 4],
          tags: { highway: "primary", layer: "-1", tunnel: "yes" },
        },
      ],
    );
    const patch = createOsm(
      "patch",
      [
        { id: 2, lon: 0, lat: 0 },
        { id: 5, lon: 0, lat: -1 },
      ],
      [{ id: 20, refs: [2, 5], tags: { highway: "primary" } }],
    );

    await expect(merge(base, patch, { directMerge: true }, silent)).rejects.toThrow(
      "node 2 newly connects grade-separated highways 10 and 20",
    );
  });

  it("tolerates an inherited interior grade issue during an unrelated change", () => {
    const base = createOsm(
      "base",
      [
        { id: 1, lon: -1, lat: 0 },
        { id: 2, lon: 0, lat: 0 },
        { id: 3, lon: 1, lat: 0 },
        { id: 4, lon: 0, lat: 1 },
      ],
      [
        { id: 10, refs: [1, 2, 3], tags: { highway: "primary" } },
        {
          id: 20,
          refs: [2, 4],
          tags: { highway: "primary", bridge: "yes", layer: "1" },
        },
      ],
    );
    const changeset = generateChangeset(
      base,
      createOsm("patch", [{ id: 1, lon: -1, lat: 0, tags: { name: "Unrelated" } }]),
      { directMerge: true },
      silent,
    );

    expect(() => applyChangesetToOsm(changeset)).not.toThrow();
  });

  it("rejects direct merge plus intersections in one generated changeset", () => {
    const base = createOsm("base", []);
    const patch = createOsm("patch", []);

    expect(() =>
      generateChangeset(base, patch, { directMerge: true, createIntersections: true }, silent),
    ).toThrow("generateChangeset cannot combine directMerge with createIntersections");
  });

  it("keeps high-level and generated changeset reconciliation in parity", async () => {
    const base = createOsm(
      "base",
      [
        { id: 1, lon: 0, lat: 0 },
        { id: 2, lon: 1, lat: 0 },
      ],
      [{ id: 10, refs: [1, 2], tags: { highway: "residential" } }],
    );
    const patch = createOsm(
      "patch",
      [
        { id: 101, lon: 1, lat: 0 },
        { id: 102, lon: 2, lat: 0 },
      ],
      [{ id: 20, refs: [101, 102], tags: { highway: "residential" } }],
    );
    const options = { directMerge: true, deduplicateNodes: true, deduplicateWays: true };

    const highLevel = await merge(base, patch, options, silent);
    const generated = applyChangesetToOsm(generateChangeset(base, patch, options, silent));

    expect([...highLevel.nodes].map((node) => node.id)).toEqual(
      [...generated.nodes].map((node) => node.id),
    );
    expect([...highLevel.ways].map((way) => way.refs)).toEqual(
      [...generated.ways].map((way) => way.refs),
    );
  });
});
