import { describe, test } from "vitest";

import { Osm } from "../src/osm";

function createManyMemberRelations() {
  const osm = new Osm({ id: "relations-benchmark" });
  osm.nodes.addNode({ id: 1, lon: 0, lat: 0 });
  for (let id = 0; id < 10_000; id++) osm.ways.addWay({ id, refs: [1] });
  for (let relationId = 0; relationId < 100; relationId++) {
    osm.relations.addRelation({
      id: relationId,
      members: Array.from({ length: 100 }, (_, index) => ({
        type: "way" as const,
        ref: relationId * 100 + index,
        role: "",
      })),
    });
  }
  osm.buildIndexes();
  return osm;
}

const osm = createManyMemberRelations();
osm.relations.isWayMember(0);

describe("relation way membership cache", () => {
  test("1000 repeated cached lookups", async ({ bench }) => {
    await bench("1000 repeated cached lookups", () => {
      for (let i = 0; i < 1000; i++) osm.relations.isWayMember(i);
    }).run();
  });
});
