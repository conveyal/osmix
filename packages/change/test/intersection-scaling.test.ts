import { Osm } from "@osmix/core";
import { describe, expect, it } from "vitest";

import { applyChangesetToOsm } from "../src/apply-changeset.ts";
import { OsmChangeset } from "../src/changeset.ts";

function isolatedJunctions(count: number) {
  const osm = new Osm({ id: `junction-scaling-${count}` });
  const patch = new Osm({ id: `junction-patch-${count}` });
  for (let index = 0; index < count; index++) {
    const id = 1 + 4 * index;
    const lon = index * 0.01;
    osm.nodes.addNode({ id, lon: lon - 0.001, lat: 0 });
    osm.nodes.addNode({ id: id + 1, lon, lat: 0 });
    for (const node of [
      { id: id + 2, lon, lat: 0 },
      { id: id + 3, lon, lat: 0.001 },
    ]) {
      osm.nodes.addNode(node);
      patch.nodes.addNode(node);
    }
    osm.ways.addWay({ id, refs: [id, id + 1], tags: { highway: "primary" } });
    const way = { id: id + 2, refs: [id + 2, id + 3], tags: { highway: "primary" } };
    osm.ways.addWay(way);
    patch.ways.addWay(way);
  }
  for (const data of [osm, patch]) {
    data.buildIndexes();
    data.buildSpatialIndexes();
  }
  return { osm, patch };
}

describe("intersection junction scaling", () => {
  it.each([24, 96])(
    "bounds pending-way enumeration when remapping %i isolated junctions",
    (junctionCount) => {
      const { osm, patch } = isolatedJunctions(junctionCount);
      const changeset = new OsmChangeset(osm);
      // Seed pending changes before the first junction lookup, as restored and
      // incrementally prepared changesets can contain them already.
      for (const way of patch.ways) {
        changeset.modify("way", way.id, (current) => ({
          ...current,
          tags: { ...current.tags, name: "Imported approach" },
        }));
      }
      let pendingEntryVisits = 0;
      changeset.wayChanges = new Proxy(changeset.wayChanges, {
        ownKeys(target) {
          const keys = Reflect.ownKeys(target);
          pendingEntryVisits += keys.length;
          return keys;
        },
      });

      changeset.createIntersectionsForWays(patch.ways);

      // Permit a bounded number of whole-collection passes, not one per endpoint.
      // Counting inspected entries avoids hardware-dependent timing assertions.
      expect(pendingEntryVisits).toBeLessThanOrEqual(junctionCount * 4);
      const result = applyChangesetToOsm(changeset);
      for (let index = 0; index < junctionCount; index++) {
        const id = 1 + 4 * index;
        expect(result.ways.getById(id)?.refs).toEqual([id, id + 1]);
        expect(result.ways.getById(id + 2)?.refs).toEqual([id + 1, id + 3]);
        expect(result.ways.getById(id + 2)?.tags?.["name"]).toBe("Imported approach");
      }
    },
  );
});
