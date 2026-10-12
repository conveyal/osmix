import { changesetStatsAtom } from "@osmix/app-core";
import { createStore, Provider } from "jotai";
import type { OsmChange, OsmChangesetStats } from "osmix";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import ChangesSummary, { ChangesFilters } from "../src/components/osm-changes-summary.tsx";
import { changeDescription, entityTagHint, entityTitle } from "../src/lib/change-labels.ts";

const node = (id: number, tags?: Record<string, string>) => ({ id, lon: 0, lat: 0, tags });

describe("change labels", () => {
  it("titles an entity in sentence case", () => {
    expect(entityTitle(node(2066450))).toBe("Node 2066450");
    expect(entityTitle({ id: 7, refs: [1, 2] })).toBe("Way 7");
  });

  it("hints at what an entity is: name, then main tag, then untagged", () => {
    expect(entityTagHint(node(1, { name: "Main St", highway: "residential" }))).toBe("Main St");
    expect(entityTagHint(node(1, { surface: "asphalt", highway: "crossing" }))).toBe(
      "highway=crossing",
    );
    expect(entityTagHint(node(1, { surface: "asphalt" }))).toBe("surface=asphalt");
    expect(entityTagHint(node(1))).toBe("untagged");
  });

  it("names the survivor of a deleted duplicate", () => {
    const change: OsmChange = {
      changeType: "delete",
      entity: node(1),
      oldEntity: node(1),
      osmId: "a",
      refs: [{ type: "node", id: 11, osmId: "a" }],
    };
    expect(changeDescription(change, { duplicates: true })).toBe("Duplicate of node 11 · untagged");
    expect(changeDescription(change)).toBe("Replaced by node 11 · untagged");
  });

  it("counts the references a modification rewrote", () => {
    const change: OsmChange = {
      changeType: "modify",
      entity: { id: 40, refs: [22, 12, 13], tags: { highway: "footway" } },
      oldEntity: { id: 40, refs: [22, 2, 3], tags: { highway: "footway" } },
      osmId: "a",
    };
    expect(changeDescription(change)).toBe("2 node references rewritten · highway=footway");
    const retagged: OsmChange = {
      changeType: "modify",
      entity: node(5, { highway: "crossing" }),
      oldEntity: node(5),
      osmId: "a",
    };
    expect(changeDescription(retagged)).toBe("Tags changed · untagged");
  });
});

const STATS: OsmChangesetStats = {
  osmId: "dataset",
  totalChanges: 5,
  nodeChanges: 3,
  wayChanges: 2,
  relationChanges: 0,
  createChanges: 0,
  modifyChanges: 1,
  deleteChanges: 4,
  deduplicatedNodes: 3,
  deduplicatedNodesReplaced: 4,
  deduplicatedWays: 1,
  intersectionPointsFound: 0,
  intersectionNodesCreated: 0,
  intersectionNodesRemoved: 0,
};

function render(element: React.ReactElement, stats: OsmChangesetStats) {
  const store = createStore();
  store.set(changesetStatsAtom, stats);
  return renderToStaticMarkup(createElement(Provider, { store }, element));
}

describe("ChangesSummary", () => {
  it("leads with one sentence and keeps the table closed", () => {
    const html = render(createElement(ChangesSummary, { variant: "deduplication" }), STATS);
    expect(html).toContain(
      "3 duplicate nodes and 1 duplicate way. Applying them rewrites 4 node references.",
    );
    expect(html).toContain('aria-expanded="false"');
    expect(html).not.toContain("Total changes");
  });

  it("says when a scan found nothing", () => {
    const empty = { ...STATS, totalChanges: 0 };
    const html = render(createElement(ChangesSummary, { variant: "deduplication" }), empty);
    expect(html).toContain("No duplicate nodes or ways found");
  });
});

describe("ChangesFilters", () => {
  it("offers only the types present, with counts", () => {
    const html = render(createElement(ChangesFilters), STATS);
    expect(html).toContain("Modify");
    expect(html).toContain("Delete");
    expect(html).not.toContain("Create");
    expect(html).toContain("Node");
    expect(html).not.toContain("Relation");
    expect(html).toMatch(/Delete<span[^>]*>4<\/span>/);
  });

  it("leaves out a group with nothing to choose between", () => {
    const deletesOnly = { ...STATS, modifyChanges: 0, deleteChanges: 5 };
    const html = render(createElement(ChangesFilters), deletesOnly);
    expect(html.match(/<legend/g)).toHaveLength(1);
    expect(html).toContain("Entity");
    expect(html).not.toContain(">Change<");
  });

  it("renders nothing when no group has a choice", () => {
    const html = render(createElement(ChangesFilters), {
      ...STATS,
      nodeChanges: 5,
      wayChanges: 0,
      modifyChanges: 0,
      deleteChanges: 5,
    });
    expect(html).toBe("");
  });
});
