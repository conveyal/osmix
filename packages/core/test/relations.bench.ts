import { bench, describe } from "vitest";

import { Osm } from "../src/osm";

function createManyMemberRelations() {
  const osm = new Osm({ id: "relations-benchmark" });
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
  return osm;
}

const osm = createManyMemberRelations();
osm.relations.getWayMemberIds();

describe("relation way membership cache", () => {
  bench("1000 repeated cached lookups", () => {
    for (let i = 0; i < 1000; i++) osm.relations.getWayMemberIds();
  });
});
