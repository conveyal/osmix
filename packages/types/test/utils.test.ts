import { dequal } from "dequal";
import { describe, expect, it } from "vitest";

import type { OsmNode, OsmRelation, OsmRelationMember, OsmWay } from "../src/types.ts";
import {
  entityPropertiesEqual,
  getEntityType,
  isDeepEqual,
  isMultipolygonRelation,
  isNode,
  isNodeEqual,
  isRelation,
  isRelationEqual,
  isWay,
  isWayEqual,
} from "../src/utils.ts";

describe("utils", () => {
  const node: OsmNode = {
    id: 1,
    lat: 10,
    lon: 20,
    tags: { name: "node" },
  };
  const way: OsmWay = {
    id: 2,
    refs: [1, 2, 3],
    tags: { highway: "residential" },
  };
  const members: OsmRelationMember[] = [
    {
      type: "node",
      ref: 1,
    },
  ];
  const relation: OsmRelation = {
    id: 3,
    members,
    tags: { type: "multipolygon" },
  };

  it("narrows entity types", () => {
    expect(isNode(node)).toBe(true);
    expect(isWay(way)).toBe(true);
    expect(isRelation(relation)).toBe(true);
  });

  it("compares entity equality", () => {
    expect(isNodeEqual(node, { ...node })).toBe(true);
    expect(isWayEqual(way, { ...way })).toBe(true);
    expect(isRelationEqual(relation, { ...relation })).toBe(true);
  });

  it("detects property differences", () => {
    expect(entityPropertiesEqual(node, { ...node, tags: { name: "changed" } })).toBe(false);
    expect(entityPropertiesEqual(way, { ...way, refs: [1, 2, 4] })).toBe(false);
    expect(
      entityPropertiesEqual(relation, {
        ...relation,
        members: [{ type: "node", ref: 2 }],
      }),
    ).toBe(false);
  });

  it("provides entity type", () => {
    expect(getEntityType(node)).toBe("node");
    expect(getEntityType(way)).toBe("way");
    expect(getEntityType(relation)).toBe("relation");
  });

  describe("isMultipolygonRelation", () => {
    it("identifies multipolygon relations", () => {
      const relation: OsmRelation = {
        id: 1,
        tags: { type: "multipolygon" },
        members: [],
      };
      expect(isMultipolygonRelation(relation)).toBe(true);
    });

    it("rejects non-multipolygon relations", () => {
      const relation: OsmRelation = {
        id: 1,
        tags: { type: "route" },
        members: [],
      };
      expect(isMultipolygonRelation(relation)).toBe(false);
    });

    it("rejects relations without type tag", () => {
      const relation: OsmRelation = {
        id: 1,
        tags: { name: "test" },
        members: [],
      };
      expect(isMultipolygonRelation(relation)).toBe(false);
    });
  });
});

describe("isDeepEqual", () => {
  const values: unknown[] = [
    undefined,
    null,
    0,
    -0,
    1,
    Number.NaN,
    "",
    "a",
    true,
    false,
    [],
    [1, 2],
    [2, 1],
    [
      [1, 2],
      [3, 4],
    ],
    [
      [1, 2],
      [3, 5],
    ],
    {},
    { a: 1 },
    { a: undefined },
    { b: 1 },
    { a: 1, b: { c: [1, "x"] } },
    { b: { c: [1, "x"] }, a: 1 },
    { a: 1, b: { c: [1, "y"] } },
    [{ type: "way", ref: 1, role: "outer" }],
    [{ type: "way", ref: 1, role: "inner" }],
  ];

  it("matches dequal for JSON-like values", () => {
    for (const a of values) {
      for (const b of values) {
        expect(isDeepEqual(a, b), `${JSON.stringify(a)} vs ${JSON.stringify(b)}`).toBe(
          dequal(a, b),
        );
        expect(isDeepEqual(structuredClone(a), b)).toBe(dequal(a, b));
      }
    }
  });

  it("throws for objects it does not compare", () => {
    expect(() => isDeepEqual(new Uint32Array([1]), new Uint32Array([1]))).toThrow(TypeError);
    expect(() => isDeepEqual(new Map(), {})).toThrow(TypeError);
    expect(() => isDeepEqual([1], new Set([1]))).toThrow(TypeError);
  });
});
