import { describe, expect, it } from "vitest";

import {
  MAX_RELATION_MEMBERS,
  MAX_STRING_BYTES,
  MAX_UINT32_OFFSET,
  MAX_WAY_REFS,
  Osm,
  OsmCapacityError,
  Relations,
  Tags,
  assertCapacity,
} from "../src";
import StringTable from "../src/stringtable.ts";

describe("storage capacity limits", () => {
  it("stores a way with exactly MAX_WAY_REFS refs", () => {
    const osm = new Osm({ id: "max-way" });
    const refs = Array.from({ length: MAX_WAY_REFS }, (_, i) => i + 1);
    osm.ways.addWay({ id: 1, refs });
    osm.buildIndexes();
    expect(osm.ways.getById(1)?.refs).toHaveLength(MAX_WAY_REFS);
  });

  it("rejects a way with more than MAX_WAY_REFS refs instead of wrapping", () => {
    const osm = new Osm({ id: "long-way" });
    const refs = Array.from({ length: MAX_WAY_REFS + 1 }, (_, i) => i + 1);
    const add = () => osm.ways.addWay({ id: 7, refs });
    expect(add).toThrow(OsmCapacityError);
    expect(add).toThrow("Way 7 has 65,536 node refs; Osmix stores at most 65,535.");
    expect(osm.ways.size).toBe(0);
  });

  it("rejects a relation with more than MAX_RELATION_MEMBERS members", () => {
    const osm = new Osm({ id: "big-relation" });
    const members = Array.from({ length: MAX_RELATION_MEMBERS + 1 }, (_, i) => ({
      type: "node" as const,
      ref: i + 1,
    }));
    try {
      osm.relations.addRelation({ id: 9, members });
      expect.unreachable();
    } catch (error) {
      expect(error).toBeInstanceOf(OsmCapacityError);
      expect(error).toMatchObject({
        code: "OSM_CAPACITY_EXCEEDED",
        limit: "relation-members",
        value: MAX_RELATION_MEMBERS + 1,
        max: MAX_RELATION_MEMBERS,
      });
    }
    expect(osm.relations.size).toBe(0);
  });

  it("rejects a string longer than MAX_STRING_BYTES UTF-8 bytes", () => {
    const table = new StringTable();
    const fits = "a".repeat(MAX_STRING_BYTES);
    expect(table.get(table.add(fits))).toBe(fits);
    // "é" is two UTF-8 bytes, so this string is short in characters but too long in bytes.
    const tooLong = "é".repeat((MAX_STRING_BYTES + 1) / 2);
    expect(() => table.add(tooLong)).toThrow(OsmCapacityError);
    expect(() => table.add(tooLong)).toThrow(/65,536 UTF-8 bytes/);
  });

  it("reports dataset-wide offset overflow", () => {
    expect(() =>
      assertCapacity("total-way-refs", MAX_UINT32_OFFSET + 1, MAX_UINT32_OFFSET, () => "Data"),
    ).toThrow("Data has 4,294,967,296 node refs; Osmix stores at most 4,294,967,295.");
    expect(() =>
      assertCapacity("total-way-refs", MAX_UINT32_OFFSET, MAX_UINT32_OFFSET, () => "Data"),
    ).not.toThrow();
  });
});

describe("byte estimators", () => {
  it("counts tag pairs at 12 bytes each", () => {
    expect(Tags.getBytesRequired(10, 10, 5) - Tags.getBytesRequired(10, 10)).toBe(60);
  });

  it("counts relation members at 13 bytes each", () => {
    expect(Relations.getBytesRequired(1, 4) - Relations.getBytesRequired(1)).toBe(52);
  });
});
