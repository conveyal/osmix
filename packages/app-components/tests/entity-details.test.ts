import { Osm, type OsmNode } from "osmix";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { NodeListTable, RelationMemberListTable } from "../src/components/entity-details.tsx";

const nodes: OsmNode[] = [
  { id: 1, lon: 7.42, lat: 43.73 },
  { id: 2, lon: 7.43, lat: 43.74, tags: { name: "Two" } },
];

function fixture() {
  const osm = new Osm({ id: "entity-details" });
  for (const node of nodes) osm.nodes.addNode(node);
  osm.nodes.buildIndex();
  osm.ways.addWay({ id: 10, refs: [1, 2], tags: { highway: "footway" } });
  osm.buildIndexes();
  return osm;
}

const selectButtons = (html: string) => html.match(/aria-label="Select [^"]+"/g) ?? [];
/** The rows themselves are plain: the button, not the row, carries the pointer cursor. */
const clickableRows = (html: string) => html.match(/<tr[^>]*cursor-pointer/g) ?? [];

describe("NodeListTable", () => {
  it("offers one select button per node, with the row left plain", () => {
    const html = renderToStaticMarkup(
      createElement(NodeListTable, { nodes, onSelect: () => undefined }),
    );
    expect(selectButtons(html)).toEqual([
      'aria-label="Select node 1"',
      'aria-label="Select node 2"',
    ]);
    expect(clickableRows(html)).toEqual([]);
    expect(html).toContain("select-all");
    // The button carries the id itself.
    expect(html).toMatch(/<button[^>]*aria-label="Select node 1"[^>]*>1<\/button>/);
  });

  it("lists plain ids without a handler", () => {
    const html = renderToStaticMarkup(createElement(NodeListTable, { nodes }));
    expect(selectButtons(html)).toEqual([]);
    expect(html).not.toContain("<button");
    expect(html).toContain("Two");
  });
});

describe("RelationMemberListTable", () => {
  const members = [
    { type: "node" as const, ref: 1, role: "stop" },
    { type: "way" as const, ref: 10, role: "" },
    { type: "way" as const, ref: 99, role: "" },
  ];

  it("offers a select button for each member that resolves", () => {
    const html = renderToStaticMarkup(
      createElement(RelationMemberListTable, {
        members,
        osm: fixture(),
        onSelect: () => undefined,
      }),
    );
    expect(selectButtons(html)).toEqual([
      'aria-label="Select node 1"',
      'aria-label="Select way 10"',
    ]);
    expect(html).toContain("not found");
    expect(clickableRows(html)).toEqual([]);
  });

  it("lists plain ids without a handler", () => {
    const html = renderToStaticMarkup(
      createElement(RelationMemberListTable, { members, osm: fixture() }),
    );
    expect(html).not.toContain("<button");
    expect(html).toContain("2 nodes");
  });
});
