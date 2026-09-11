import { Osm } from "@osmix/core";
import { describe, expect, it } from "vitest";

import {
  applyChangesetToOsm,
  generateChangeset,
  type OsmChanges,
  OsmChangeset,
} from "../src/index.ts";

function createInheritedGradeIssue(id = "patch") {
  const osm = new Osm({ id });
  for (const node of [
    { id: 1, lon: -0.001, lat: 0 },
    { id: 2, lon: 0, lat: 0 },
    { id: 3, lon: 0.001, lat: 0 },
    { id: 4, lon: 0, lat: 0.001 },
  ]) {
    osm.nodes.addNode(node);
  }
  osm.ways.addWay({ id: 10, refs: [1, 2, 3], tags: { highway: "primary" } });
  osm.ways.addWay({
    id: 20,
    refs: [2, 4],
    tags: { highway: "primary", bridge: "yes", layer: "1" },
  });
  osm.buildIndexes();
  osm.buildSpatialIndexes();
  return osm;
}

function emptyOsm(id = "base") {
  const osm = new Osm({ id });
  osm.buildIndexes();
  osm.buildSpatialIndexes();
  return osm;
}

function createValidNetwork(id = "patch", changedName = false) {
  const osm = new Osm({ id });
  for (const node of [
    { id: 1, lon: -0.001, lat: 0 },
    { id: 2, lon: 0, lat: 0 },
    { id: 3, lon: 0.001, lat: 0 },
    { id: 4, lon: 0, lat: 0.001 },
    { id: 5, lon: 0, lat: 0 },
    { id: 6, lon: 0, lat: -0.001 },
  ]) {
    osm.nodes.addNode(node);
  }
  osm.ways.addWay({
    id: 10,
    refs: [1, 2, 3],
    tags: { highway: "primary", name: changedName ? "Changed" : "Original" },
  });
  osm.ways.addWay({
    id: 20,
    refs: [5, 4],
    tags: { highway: "primary", bridge: "yes", layer: "1" },
  });
  osm.ways.addWay({ id: 30, refs: [2, 6], tags: { highway: "primary" } });
  osm.relations.addRelation({
    id: 100,
    tags: { type: "restriction", restriction: "only_right_turn" },
    members: [
      { type: "way", ref: 10, role: "from" },
      { type: "node", ref: 2, role: "via" },
      { type: "way", ref: 30, role: "to" },
    ],
  });
  osm.buildIndexes();
  osm.buildSpatialIndexes();
  return osm;
}

function versionedJson(changeset: OsmChangeset): OsmChanges {
  return JSON.parse(JSON.stringify(changeset));
}

function legacyJson(changeset: OsmChangeset): OsmChanges {
  return JSON.parse(
    JSON.stringify({
      osmId: changeset.osm.id,
      nodes: changeset.nodeChanges,
      ways: changeset.wayChanges,
      relations: changeset.relationChanges,
      stats: changeset.stats,
    }),
  );
}

function entities(osm: Osm) {
  return {
    nodes: [...osm.nodes.sorted()],
    ways: [...osm.ways.sorted()],
    relations: [...osm.relations.sorted()],
  };
}

describe("changeset serialization preserves validation context", () => {
  it.each(["valid", "inherited issue"] as const)(
    "keeps safe legacy changes usable with a %s base",
    (kind) => {
      const base = kind === "valid" ? emptyOsm() : createInheritedGradeIssue("base");
      const changeset = new OsmChangeset(base);
      changeset.create(
        { id: 9, lon: 0.02, lat: 0.02, tags: { name: "Unrelated addition" } },
        "patch",
      );
      const expected = applyChangesetToOsm(changeset);
      const restored = OsmChangeset.fromJson(base, legacyJson(changeset));
      expect(entities(applyChangesetToOsm(restored))).toEqual(entities(expected));
      expect(versionedJson(restored).validationContext).toBeUndefined();
    },
  );

  it("retains inherited patch grade issues through a supported JSON round trip", () => {
    const base = emptyOsm();
    const patch = createInheritedGradeIssue();
    const changeset = generateChangeset(base, patch, { directMerge: true }, () => {});
    const expected = applyChangesetToOsm(changeset);
    const restored = OsmChangeset.fromJson(base, versionedJson(changeset), {
      patches: [new Osm(patch.transferables())],
    });
    expect(entities(applyChangesetToOsm(restored))).toEqual(entities(expected));
  });

  it("retains validation context through repeated serialization", () => {
    const base = emptyOsm();
    const patch = createInheritedGradeIssue();
    const original = generateChangeset(base, patch, { directMerge: true }, () => {});
    const first = OsmChangeset.fromJson(base, versionedJson(original), { patches: [patch] });
    const second = OsmChangeset.fromJson(base, versionedJson(first), { patches: [patch] });
    expect(entities(applyChangesetToOsm(second))).toEqual(entities(applyChangesetToOsm(original)));
  });

  it("records newly known patch context when extending safely restored legacy changes", () => {
    const base = emptyOsm();
    const legacy = new OsmChangeset(base);
    legacy.create({ id: 9, lon: 0.02, lat: 0.02, tags: { name: "Legacy addition" } }, "legacy");
    const extended = OsmChangeset.fromJson(base, legacyJson(legacy));
    expect(versionedJson(extended).validationContext).toBeUndefined();
    const patch = createInheritedGradeIssue();

    extended.generateDirectChanges(patch);

    const json = versionedJson(extended);
    expect(json.validationContext?.patches).toHaveLength(1);
    expect(json.validationContext?.patches[0]?.id).toBe(patch.id);
    const restored = OsmChangeset.fromJson(base, json, { patches: [patch] });
    const expected = applyChangesetToOsm(extended);
    expect(expected.nodes.getById(9)?.tags).toEqual({ name: "Legacy addition" });
    expect(entities(applyChangesetToOsm(restored))).toEqual(entities(expected));
  });

  it("requires original patch inputs for versioned JSON", () => {
    const base = emptyOsm();
    const patch = createValidNetwork();
    const changeset = generateChangeset(base, patch, { directMerge: true }, () => {});
    expect(() => OsmChangeset.fromJson(base, versionedJson(changeset))).toThrow(/patch|context/i);
  });

  it.each(["base ID", "base content", "patch ID", "patch content", "patch count"] as const)(
    "rejects mismatched %s even when dataset keys are otherwise reusable",
    (mismatch) => {
      const base = emptyOsm();
      const patch = createValidNetwork();
      const changeset = generateChangeset(base, patch, { directMerge: true }, () => {});
      const matchingBase = new Osm(base.transferables());
      const suppliedBase =
        mismatch === "base ID"
          ? new Osm({ ...base.transferables(), id: "different-base" })
          : mismatch === "base content"
            ? createValidNetwork(base.id)
            : matchingBase;
      const suppliedPatch =
        mismatch === "patch ID"
          ? new Osm({ ...patch.transferables(), id: "different-patch" })
          : mismatch === "patch content"
            ? createValidNetwork(patch.id, true)
            : new Osm(patch.transferables());
      expect(() =>
        OsmChangeset.fromJson(suppliedBase, versionedJson(changeset), {
          patches: mismatch === "patch count" ? [suppliedPatch, suppliedPatch] : [suppliedPatch],
        }),
      ).toThrow(/base|patch|input|context/i);
    },
  );

  it("verifies multiple patch inputs in their original generation order", () => {
    const base = emptyOsm();
    const patch = createInheritedGradeIssue();
    const addition = new Osm({ id: "second-patch" });
    addition.nodes.addNode({ id: 9, lon: 0.02, lat: 0.02, tags: { name: "Second import" } });
    addition.buildIndexes();
    addition.buildSpatialIndexes();
    const changeset = generateChangeset(base, patch, { directMerge: true }, () => {});
    changeset.generateDirectChanges(addition);
    const json = versionedJson(changeset);
    const restored = OsmChangeset.fromJson(base, json, { patches: [patch, addition] });
    expect(restored.toJSON().validationContext).toEqual(json.validationContext);
    expect(entities(applyChangesetToOsm(restored))).toEqual(
      entities(applyChangesetToOsm(changeset)),
    );
    expect(() => OsmChangeset.fromJson(base, json, { patches: [addition, patch] })).toThrow(
      /patch|input|context/i,
    );
  });

  it.each(["context", "content hash"] as const)("rejects unsupported %s versions", (kind) => {
    const base = emptyOsm();
    const changeset = new OsmChangeset(base);
    const json = versionedJson(changeset);
    const context = json.validationContext!;
    const invalid: OsmChanges = JSON.parse(
      JSON.stringify({
        ...json,
        validationContext:
          kind === "context"
            ? { ...context, version: 999 }
            : { ...context, base: { ...context.base, contentHashVersion: 999 } },
      }),
    );
    expect(() => OsmChangeset.fromJson(base, invalid)).toThrow(/version|context|base/i);
  });

  it("explains why legacy JSON cannot recover inherited patch allowances", () => {
    const base = emptyOsm();
    const patch = createInheritedGradeIssue();
    const changeset = generateChangeset(base, patch, { directMerge: true }, () => {});
    const json = legacyJson(changeset);
    const restored = OsmChangeset.fromJson(base, json);
    expect(() => applyChangesetToOsm(restored)).toThrow(/regenerate.*toJSON/is);
    const reexported = versionedJson(restored);
    expect(reexported.validationContext).toBeUndefined();
    expect(() => applyChangesetToOsm(OsmChangeset.fromJson(base, reexported))).toThrow(
      /regenerate.*toJSON/is,
    );
    expect(() => OsmChangeset.fromJson(base, json, { patches: [patch] })).toThrow(
      /legacy|context/i,
    );
  });

  it.each([
    "dangling reference",
    "collapsed highway",
    "broken restriction",
    "new grade connection",
  ] as const)("still rejects a %s introduced after valid input generation", (failure) => {
    const base = emptyOsm();
    const patch = createValidNetwork();
    const changeset = generateChangeset(base, patch, { directMerge: true }, () => {});
    let expected: RegExp;
    if (failure === "dangling reference") {
      changeset.modify("way", 10, (way) => ({ ...way, refs: [1, 999, 3] }));
      expected = /missing node 999/i;
    } else if (failure === "collapsed highway") {
      changeset.modify("way", 10, (way) => ({ ...way, refs: [1] }));
      expected = /fewer than two distinct nodes|degenerate/i;
    } else if (failure === "broken restriction") {
      changeset.modify("relation", 100, (relation) => ({
        ...relation,
        members: relation.members.map((member) =>
          member.role === "via" ? { ...member, ref: 3 } : member,
        ),
      }));
      expected = /restriction 100.*via node 3.*detached/i;
    } else {
      changeset.modify("way", 20, (way) => ({ ...way, refs: [5, 2, 4] }));
      expected = /node 2.*grade-separated highways 10 and 20/i;
    }
    expect(() => applyChangesetToOsm(changeset)).toThrow(expected);
    const restored = OsmChangeset.fromJson(base, versionedJson(changeset), { patches: [patch] });
    expect(() => applyChangesetToOsm(restored)).toThrow(expected);
  });

  it("does not grant caller-supplied issue exemptions", () => {
    const base = emptyOsm();
    const patch = createValidNetwork();
    const changeset = generateChangeset(base, patch, { directMerge: true }, () => {});
    changeset.modify("way", 20, (way) => ({ ...way, refs: [5, 2, 4] }));
    const json = versionedJson(changeset);
    const forged = {
      ...json,
      routingIntegrityBaselineKeys: ["node:2:incompatible-grade:10:20"],
      validationContext: {
        ...json.validationContext!,
        routingIntegrityBaselineKeys: ["node:2:incompatible-grade:10:20"],
      },
    };
    expect(() =>
      applyChangesetToOsm(OsmChangeset.fromJson(base, forged, { patches: [patch] })),
    ).toThrow(/grade-separated|exemption/i);
  });

  it("restores nested changes without retaining aliases to the serialized object", () => {
    const base = emptyOsm();
    const patch = createValidNetwork();
    const original = generateChangeset(base, patch, { directMerge: true }, () => {});
    const json = versionedJson(original);
    const restored = OsmChangeset.fromJson(base, json, { patches: [patch] });
    json.ways[10]!.entity.refs[1] = 999;
    json.ways[10]!.entity.tags = { highway: "primary", name: "Mutated outside" };
    json.relations[100]!.entity.members[1]!.ref = 3;
    expect(entities(applyChangesetToOsm(restored))).toEqual(
      entities(applyChangesetToOsm(original)),
    );
  });

  it("allocates new IDs above nodes supplied by the restored changes", () => {
    const base = emptyOsm();
    const patch = createValidNetwork();
    const original = generateChangeset(base, patch, { directMerge: true }, () => {});
    original.create({ id: 900, lon: 0.02, lat: 0.02 }, "additional");
    const restored = OsmChangeset.fromJson(base, versionedJson(original), { patches: [patch] });
    const id = restored.nextNodeId();
    expect(id).toBe(901);
    restored.create({ id, lon: 0.03, lat: 0.03 }, "additional");
    const result = applyChangesetToOsm(restored);
    expect(result.nodes.ids.has(900)).toBe(true);
    expect(result.nodes.ids.has(901)).toBe(true);
  });
});
