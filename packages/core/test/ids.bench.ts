import { bench, describe } from "vitest";

import { Ids } from "../src/ids";
import { Osm } from "../src/osm";

const values = Array.from({ length: 20_000 }, (_, index) => (index * 7919) % 100_000);

function buildIds() {
  const ids = new Ids();
  for (const value of values) ids.add(value);
  ids.buildIndex();
  return ids;
}

const osm = new Osm();
for (const value of values) osm.nodes.addNode({ id: value, lon: value, lat: value });
osm.buildIndexes();

describe("sorted ID iteration", () => {
  bench("build shuffled sorted index", () => {
    buildIds();
  });

  bench("iterate all sorted entities", () => {
    let checksum = 0;
    for (const node of osm.nodes.sorted()) checksum += node.id + node.lon;
    if (checksum === 0) throw Error("Unexpected empty benchmark");
  });
});
