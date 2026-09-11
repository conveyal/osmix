import { Osm } from "@osmix/core";
import type { OsmTags } from "@osmix/types";
import { describe, expect, it } from "vitest";

import { discoverConflationCandidates, merge } from "../src/index.ts";

interface DirectionCase {
  name: string;
  base?: string;
  patch?: string;
  roundabout?: boolean;
  reversed?: boolean;
  compatible: boolean;
}

const directionCases: DirectionCase[] = [
  { name: "yes and true", base: "yes", patch: "true", compatible: true },
  { name: "true and 1", base: "true", patch: "1", compatible: true },
  { name: "1 and yes", base: "1", patch: "yes", compatible: true },
  { name: "no and false", base: "no", patch: "false", compatible: true },
  { name: "false and 0", base: "false", patch: "0", compatible: true },
  { name: "0 and no", base: "0", patch: "no", compatible: true },
  { name: "reverse and -1", base: "reverse", patch: "-1", compatible: true },
  { name: "case-insensitive aliases", base: "YES", patch: "True", compatible: true },
  { name: "ordinary way default and no", patch: "no", compatible: true },
  { name: "ordinary empty value and no", base: "", patch: "no", compatible: true },
  { name: "roundabout default and yes", patch: "yes", roundabout: true, compatible: true },
  {
    name: "roundabout empty value and yes",
    base: "",
    patch: "yes",
    roundabout: true,
    compatible: true,
  },
  { name: "roundabout 0 and no", base: "0", patch: "no", roundabout: true, compatible: true },
  {
    name: "roundabout false and no",
    base: "false",
    patch: "no",
    roundabout: true,
    compatible: true,
  },
  { name: "roundabout 0 and yes", base: "0", patch: "yes", roundabout: true, compatible: false },
  {
    name: "roundabout false and yes",
    base: "false",
    patch: "yes",
    roundabout: true,
    compatible: false,
  },
  { name: "ordinary default and yes", patch: "yes", compatible: false },
  { name: "roundabout default and no", patch: "no", roundabout: true, compatible: false },
  {
    name: "matching unsupported reversible values",
    base: "reversible",
    patch: "reversible",
    compatible: false,
  },
  {
    name: "matching unsupported alternating values",
    base: "alternating",
    patch: "alternating",
    compatible: false,
  },
  {
    name: "matching whitespace-padded values",
    base: " yes ",
    patch: " yes ",
    compatible: false,
  },
];

const reverseCases: DirectionCase[] = [
  {
    name: "reversed geometry with yes and -1",
    base: "yes",
    patch: "-1",
    reversed: true,
    compatible: true,
  },
  {
    name: "reversed geometry with reverse and true",
    base: "reverse",
    patch: "true",
    reversed: true,
    compatible: true,
  },
  {
    name: "reversed bidirectional geometry",
    base: "no",
    patch: "false",
    reversed: true,
    compatible: true,
  },
  {
    name: "reversed geometry with matching forward tags",
    base: "yes",
    patch: "yes",
    reversed: true,
    compatible: false,
  },
];

function createWay(
  id: string,
  firstNodeId: number,
  wayId: number,
  lat: number,
  tags: OsmTags,
  reversed: boolean,
) {
  const osm = new Osm({ id });
  osm.nodes.addNode({ id: firstNodeId, lon: 0, lat });
  osm.nodes.addNode({ id: firstNodeId + 1, lon: 0.001, lat });
  osm.ways.addWay({
    id: wayId,
    refs: reversed ? [firstNodeId + 1, firstNodeId] : [firstNodeId, firstNodeId + 1],
    tags,
  });
  osm.buildIndexes();
  osm.buildSpatialIndexes();
  return osm;
}

function createFixture(testCase: DirectionCase, exact: boolean) {
  const baseTags: OsmTags = { highway: "residential", name: "Base" };
  const patchTags: OsmTags = { highway: "residential", name: "Imported" };
  if (testCase.base !== undefined) baseTags["oneway"] = testCase.base;
  if (testCase.patch !== undefined) patchTags["oneway"] = testCase.patch;
  if (testCase.roundabout) {
    baseTags["junction"] = "roundabout";
    patchTags["junction"] = "roundabout";
  }
  return {
    base: createWay("base", 1, 10, 0, baseTags, false),
    patch: createWay(
      "patch",
      exact ? 1 : 101,
      20,
      exact ? 0 : 0.000004,
      patchTags,
      testCase.reversed ?? false,
    ),
  };
}

function createRoundabout(
  id: string,
  patch: boolean,
  reversed: boolean,
  oneway: string,
  additionalTags: OsmTags = {},
) {
  const osm = new Osm({ id });
  const firstNodeId = patch ? 101 : 1;
  const offset = patch ? 0.000004 : 0;
  const coordinates: [number, number][] = [
    [0, 0],
    [0.001, 0],
    [0.001, 0.001],
    [0, 0.001],
  ];
  for (const [index, coordinate] of coordinates.entries()) {
    osm.nodes.addNode({
      id: firstNodeId + index,
      lon: coordinate[0],
      lat: coordinate[1] + offset,
    });
  }
  osm.ways.addWay({
    id: patch ? 20 : 10,
    refs: (reversed ? [0, 3, 2, 1, 0] : [0, 1, 2, 3, 0]).map((index) => firstNodeId + index),
    tags: {
      highway: "residential",
      junction: "roundabout",
      oneway,
      name: patch ? "Imported" : "Base",
      ...additionalTags,
    },
  });
  osm.buildIndexes();
  osm.buildSpatialIndexes();
  return osm;
}

describe("way direction compatibility", () => {
  it.each(directionCases)("exact reconciliation respects $name", async (testCase) => {
    const { base, patch } = createFixture(testCase, true);
    const result = await merge(base, patch, { directMerge: true, deduplicateWays: true }, () => {});
    expect(result.ways.getById(10)).toEqual(base.ways.getById(10));
    expect(result.ways.ids.has(20)).toBe(!testCase.compatible);
    if (!testCase.compatible) expect(result.ways.getById(20)).toEqual(patch.ways.getById(20));
  });

  it.each([...directionCases, ...reverseCases])(
    "fuzzy matching respects $name",
    async (testCase) => {
      const { base, patch } = createFixture(testCase, false);
      const conflation = { propertyKeys: ["name"], attachNetwork: false };
      const discovery = discoverConflationCandidates(base, patch, conflation);
      expect(discovery.candidates).toHaveLength(1);
      const candidate = discovery.candidates[0];
      expect(candidate).toMatchObject({
        id: "way:20->10",
        status: testCase.compatible ? "automatic" : "blocked",
        propertyTransfer: { status: testCase.compatible ? "automatic" : "blocked" },
      });
      if (!testCase.compatible) expect(candidate?.reasons).toContain("routing-family-conflict");
      const result = await merge(base, patch, { directMerge: true, conflation }, () => {});
      expect(result.ways.getById(10)?.tags?.["name"]).toBe(
        testCase.compatible ? "Imported" : "Base",
      );
      expect(result.ways.getById(10)?.refs).toEqual([1, 2]);
      expect(result.ways.getById(10)?.tags?.["oneway"]).toBe(testCase.base);
      expect(result.ways.getById(20)).toEqual(patch.ways.getById(20));
    },
  );

  it("keeps exact reconciliation's ordered-reference requirement for reversed geometry", async () => {
    const { base, patch } = createFixture(reverseCases[0]!, true);
    const result = await merge(base, patch, { directMerge: true, deduplicateWays: true }, () => {});
    expect(result.ways.getById(10)).toEqual(base.ways.getById(10));
    expect(result.ways.getById(20)).toEqual(patch.ways.getById(20));
  });

  it.each([
    {
      name: "reversed winding and matching tags",
      reversed: true,
      baseOneway: "yes",
      oneway: "yes",
      compatible: false,
    },
    {
      name: "reversed winding and opposite tags",
      reversed: true,
      baseOneway: "yes",
      oneway: "-1",
      compatible: false,
    },
    {
      name: "matching winding and matching tags",
      reversed: false,
      baseOneway: "yes",
      oneway: "yes",
      compatible: false,
    },
    {
      name: "bidirectional rings with reversed winding",
      reversed: true,
      baseOneway: "no",
      oneway: "false",
      compatible: true,
    },
    {
      name: "bidirectional rings with matching directional speed tags",
      reversed: true,
      baseOneway: "no",
      oneway: "false",
      additionalTags: { "maxspeed:forward": "30" },
      compatible: false,
    },
  ])(
    "closed roundabouts keep uncertain orientation safe: $name",
    async ({ reversed, baseOneway, oneway, additionalTags, compatible }) => {
      const base = createRoundabout("base", false, false, baseOneway, additionalTags);
      const patch = createRoundabout("patch", true, reversed, oneway, additionalTags);
      const conflation = { propertyKeys: ["name"], attachNetwork: false };
      const discovery = discoverConflationCandidates(base, patch, conflation);
      expect(discovery.candidates).toHaveLength(1);
      expect(discovery.candidates[0]).toMatchObject({
        id: "way:20->10",
        status: compatible ? "automatic" : "blocked",
        propertyTransfer: { status: compatible ? "automatic" : "blocked" },
      });
      if (!compatible) {
        expect(discovery.candidates[0]?.reasons).toContain("routing-family-conflict");
      }
      const result = await merge(base, patch, { directMerge: true, conflation }, () => {});
      expect(result.ways.getById(10)?.tags?.["name"]).toBe(compatible ? "Imported" : "Base");
      expect(result.ways.getById(10)?.refs).toEqual([1, 2, 3, 4, 1]);
      expect(result.ways.getById(10)?.tags?.["oneway"]).toBe(baseOneway);
      if (additionalTags) expect(result.ways.getById(10)?.tags).toMatchObject(additionalTags);
      expect(result.ways.getById(20)).toEqual(patch.ways.getById(20));
    },
  );
});
