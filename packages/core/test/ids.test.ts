import { describe, expect, it, vi } from "vitest";

import { Ids } from "../src/ids";
import { Osm } from "../src/osm";

function buildIds(values: number[]) {
  const ids = new Ids();
  for (const value of values) ids.add(value);
  ids.buildIndex();
  return ids;
}

describe("Ids sorted entries", () => {
  it.each([
    { name: "empty", values: [], entries: [] },
    {
      name: "ascending",
      values: [1, 2, 3],
      entries: [
        [1, 0],
        [2, 1],
        [3, 2],
      ],
    },
    {
      name: "reverse",
      values: [3, 2, 1],
      entries: [
        [1, 2],
        [2, 1],
        [3, 0],
      ],
    },
    {
      name: "sparse",
      values: [100, 2, 50],
      entries: [
        [2, 1],
        [50, 2],
        [100, 0],
      ],
    },
    {
      name: "duplicates",
      values: [5, 2, 5, 2],
      entries: [
        [2, 1],
        [2, 3],
        [5, 0],
        [5, 2],
      ],
    },
  ])("preserves sorted ID and original-position order for $name IDs", ({ values, entries }) => {
    expect(Array.from(buildIds(values).sortedEntries())).toEqual(entries);
  });

  it("preserves sorted entries through transfer reconstruction", () => {
    const source = buildIds([9, 3, 9, 1]);
    const reconstructed = new Ids(source.transferables());

    expect(Array.from(reconstructed.sortedEntries())).toEqual([
      [1, 3],
      [3, 1],
      [9, 0],
      [9, 2],
    ]);
  });

  it("streams sorted entities without looking up each ID again", () => {
    const osm = new Osm();
    osm.nodes.addNode({ id: 2, lon: 20, lat: 20 });
    osm.nodes.addNode({ id: 1, lon: 10, lat: 10 });
    osm.nodes.addNode({ id: 1, lon: 11, lat: 11 });
    osm.buildIndexes();
    const getIndexFromId = vi.spyOn(osm.nodes.ids, "getIndexFromId");

    expect([...osm.nodes.sorted()].map((node) => [node.id, node.lon])).toEqual([
      [1, 10],
      [1, 11],
      [2, 20],
    ]);
    expect(getIndexFromId).not.toHaveBeenCalled();
  });
});
