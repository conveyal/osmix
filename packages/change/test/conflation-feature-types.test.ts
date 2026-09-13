import { Osm } from "@osmix/core";
import type { OsmTags } from "@osmix/types";
import { describe, expect, it } from "vitest";

import { discoverConflationCandidates } from "../src/index.ts";

function dataset(id: string, tags: OsmTags, kind: "node" | "way", relation = false) {
  const base = id === "base";
  const first = base ? 1 : 101;
  const wayId = base ? 10 : 20;
  const lat = base ? 0 : 0.000004;
  const osm = new Osm({ id });
  osm.nodes.addNode({ id: first, lon: 0, lat, tags: kind === "node" ? tags : undefined });
  if (kind === "way") {
    osm.nodes.addNode({ id: first + 1, lon: 0.001, lat });
    osm.ways.addWay({ id: wayId, refs: [first, first + 1], tags });
  }
  if (relation) {
    osm.relations.addRelation({
      id: base ? 1000 : 2000,
      tags: { type: "site" },
      members: [{ type: kind, ref: kind === "node" ? first : wayId, role: "" }],
    });
  }
  osm.buildIndexes();
  osm.buildSpatialIndexes();
  return osm;
}

function discover(
  baseTags: OsmTags,
  patchTags: OsmTags,
  kind: "node" | "way" = "node",
  relation = false,
) {
  return discoverConflationCandidates(
    dataset("base", { name: "Base", ...baseTags }, kind, relation),
    dataset("patch", { name: "Imported", ...patchTags }, kind, relation),
    { propertyKeys: ["name"], attachNetwork: false },
  ).candidates[0]!;
}

describe("explicit feature classification conflicts", () => {
  it.each(["node", "way"] as const)(
    "blocks school/cafe %s matches even when only name is selected",
    (kind) => {
      const match = discover({ amenity: "cafe" }, { amenity: "school" }, kind, true);
      expect(match.status).toBe("blocked");
      expect(match.propertyTransfer.reasons).toContain("feature-type-conflict");
      expect(match.evidence).toMatchObject({
        featureTypeConflicts: [{ key: "amenity", baseValue: "cafe", patchValue: "school" }],
        tagDiff: [{ key: "name", baseValue: "Base", patchValue: "Imported" }],
      });
      if (kind === "way") expect(match.reasons).toContain("relation-member");
    },
  );

  it.each([
    ["aeroway", "runway", "taxiway"],
    ["amenity", "cafe", "school"],
    ["boundary", "administrative", "national_park"],
    ["building", "school", "garage"],
    ["craft", "carpenter", "electrician"],
    ["emergency", "fire_hydrant", "phone"],
    ["healthcare", "hospital", "dentist"],
    ["historic", "memorial", "ruins"],
    ["landuse", "residential", "industrial"],
    ["leisure", "park", "playground"],
    ["man_made", "tower", "pier"],
    ["natural", "tree", "rock"],
    ["office", "lawyer", "government"],
    ["place", "city", "village"],
    ["power", "pole", "tower"],
    ["public_transport", "platform", "stop_position"],
    ["railway", "station", "level_crossing"],
    ["shop", "bakery", "supermarket"],
    ["tourism", "hotel", "museum"],
  ])(
    "compares the supported %s classification independently of selected keys",
    (key, baseValue, patchValue) => {
      const match = discover({ [key]: baseValue }, { [key]: patchValue });
      expect(match.status).toBe("blocked");
      expect(match.evidence).toMatchObject({
        featureTypeConflicts: [{ key, baseValue, patchValue }],
      });
    },
  );

  it.each([
    [{ amenity: "school" }, { amenity: "school" }],
    [{ amenity: "school" }, {}],
    [{}, { amenity: "school" }],
    [{ amenity: "school" }, { amenity: " " }],
    [{ building: "yes" }, { building: "school" }],
    [{ building: "school" }, { building: "yes" }],
    [{ building: "no" }, {}],
    [{ amenity: "cafe" }, { shop: "bakery" }],
    [{ amenity: " school " }, { amenity: "school" }],
  ])(
    "retains ordinary eligibility for compatible or unknown classifications: %o / %o",
    (baseTags, patchTags) => {
      expect(discover(baseTags, patchTags)).toMatchObject({
        status: "automatic",
        propertyTransfer: { status: "automatic", reasons: [] },
      });
    },
  );

  it.each([
    ["yes", "no"],
    ["no", "yes"],
    ["school", "no"],
    ["no", "school"],
  ])(
    "treats explicit absence as conflicting with a present feature (%s / %s)",
    (baseValue, patchValue) => {
      expect(discover({ building: baseValue }, { building: patchValue }).status).toBe("blocked");
    },
  );

  it("reports every shared classification conflict with the original values", () => {
    const match = discover(
      { amenity: "cafe", shop: "bakery" },
      { amenity: " school ", shop: "books" },
    );
    expect(match.evidence).toMatchObject({
      featureTypeConflicts: [
        { key: "amenity", baseValue: "cafe", patchValue: " school " },
        { key: "shop", baseValue: "bakery", patchValue: "books" },
      ],
    });
  });
});
