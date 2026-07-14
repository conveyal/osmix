import { Osm, type Osm as OsmType } from "@osmix/core";
import { describe, expect, it } from "vitest";

import { applyChangesetToOsm } from "../src/apply-changeset";
import { OsmChangeset } from "../src/changeset";

function createBaseOsm() {
  const osm = new Osm({ id: "base" });
  osm.nodes.addNode({ id: 1, lon: -120, lat: 46, tags: { name: "one" } });
  osm.nodes.addNode({ id: 2, lon: -120.01, lat: 46.01 });
  osm.nodes.addNode({ id: 3, lon: -120.02, lat: 46.02 });
  osm.nodes.buildIndex();
  osm.ways.addWay({ id: 10, refs: [1, 2], tags: { highway: "primary" } });
  osm.ways.addWay({ id: 11, refs: [2, 3], tags: { highway: "secondary" } });
  osm.relations.addRelation({
    id: 100,
    members: [{ type: "node", ref: 1, role: "point" }],
    tags: { type: "route" },
  });
  osm.relations.addRelation({
    id: 101,
    members: [{ type: "node", ref: 1, role: "point" }],
    tags: { type: "route" },
  });
  osm.buildIndexes();
  return osm;
}

function createChangeset(base: OsmType) {
  const changeset = new OsmChangeset(base);
  changeset.modify("node", 1, (node) => ({
    ...node,
    tags: { ...node.tags, name: "updated" },
  }));
  changeset.delete(base.nodes.getById(3)!);
  changeset.create({ id: 4, lon: -120.03, lat: 46.03 }, "patch");

  changeset.modify("way", 10, (way) => ({
    ...way,
    tags: { ...way.tags, highway: "tertiary" },
  }));
  changeset.delete(base.ways.getById(11)!);
  changeset.create({ id: 12, refs: [1, 2], tags: { highway: "residential" } }, "patch");

  changeset.modify("relation", 100, (relation) => ({
    ...relation,
    tags: { ...relation.tags, route: "bus" },
  }));
  changeset.delete(base.relations.getById(101)!);
  changeset.create(
    {
      id: 102,
      members: [{ type: "node", ref: 1, role: "point" }],
      tags: { type: "route", route: "train" },
    },
    "patch",
  );
  return changeset;
}

function serializeEntities(osm: OsmType) {
  return {
    nodes: [...osm.nodes],
    ways: [...osm.ways],
    relations: [...osm.relations],
  };
}

describe("applyChangesetToOsm", () => {
  it("preserves changeset records and supports applying the same object twice", () => {
    const base = createBaseOsm();
    const changeset = createChangeset(base);
    const before = JSON.stringify({
      nodes: changeset.nodeChanges,
      ways: changeset.wayChanges,
      relations: changeset.relationChanges,
    });

    Object.freeze(changeset.nodeChanges);
    Object.freeze(changeset.wayChanges);
    Object.freeze(changeset.relationChanges);

    const first = applyChangesetToOsm(changeset);
    const second = applyChangesetToOsm(changeset);

    expect(serializeEntities(first)).toEqual(serializeEntities(second));
    expect(serializeEntities(first)).toEqual({
      nodes: [
        { id: 1, lon: -120, lat: 46, tags: { name: "updated" } },
        { id: 2, lon: -120.01, lat: 46.01 },
        { id: 4, lon: -120.03, lat: 46.03 },
      ],
      ways: [
        { id: 10, refs: [1, 2], tags: { highway: "tertiary" } },
        { id: 12, refs: [1, 2], tags: { highway: "residential" } },
      ],
      relations: [
        {
          id: 100,
          members: [{ type: "node", ref: 1, role: "point" }],
          tags: { type: "route", route: "bus" },
        },
        {
          id: 102,
          members: [{ type: "node", ref: 1, role: "point" }],
          tags: { type: "route", route: "train" },
        },
      ],
    });
    expect(
      JSON.stringify({
        nodes: changeset.nodeChanges,
        ways: changeset.wayChanges,
        relations: changeset.relationChanges,
      }),
    ).toBe(before);
    expect(serializeEntities(base)).toEqual({
      nodes: [
        { id: 1, lon: -120, lat: 46, tags: { name: "one" } },
        { id: 2, lon: -120.01, lat: 46.01 },
        { id: 3, lon: -120.02, lat: 46.02 },
      ],
      ways: [
        { id: 10, refs: [1, 2], tags: { highway: "primary" } },
        { id: 11, refs: [2, 3], tags: { highway: "secondary" } },
      ],
      relations: [
        { id: 100, members: [{ type: "node", ref: 1, role: "point" }], tags: { type: "route" } },
        { id: 101, members: [{ type: "node", ref: 1, role: "point" }], tags: { type: "route" } },
      ],
    });
  });

  it("preserves the original error path without consuming invalid changes", () => {
    const base = createBaseOsm();
    const changeset = new OsmChangeset(base);
    const existingNode = base.nodes.getById(1)!;
    changeset.create(existingNode, "patch");
    const before = JSON.stringify(changeset.nodeChanges);

    expect(() => applyChangesetToOsm(changeset)).toThrow(
      "Changeset contains create changes for existing entities",
    );
    expect(() => applyChangesetToOsm(changeset)).toThrow(
      "Changeset contains create changes for existing entities",
    );
    expect(JSON.stringify(changeset.nodeChanges)).toBe(before);
  });

  it("does not mutate nested change entities", () => {
    const base = createBaseOsm();
    const changeset = new OsmChangeset(base);
    const way = { id: 10, refs: [1, 2], tags: { highway: "tertiary" } };
    changeset.wayChanges[10] = {
      changeType: "modify",
      entity: way,
      osmId: base.id,
    };
    const before = JSON.stringify(way);

    applyChangesetToOsm(changeset);

    expect(JSON.stringify(way)).toBe(before);
  });
});
