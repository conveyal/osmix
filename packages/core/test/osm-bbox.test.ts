import { describe, expect, it } from "vitest";

import { Osm } from "../src/osm";

describe("Osm.bbox", () => {
  it("is null for a dataset without nodes", () => {
    const osm = new Osm();
    osm.buildIndexes();

    expect(osm.bbox()).toBeNull();
    expect(osm.info().bbox).toBeNull();
  });

  it("covers every node once nodes are added", () => {
    const osm = new Osm();
    osm.nodes.addNode({ id: 1, lon: -9.2, lat: 38.7 });
    osm.nodes.addNode({ id: 2, lon: -8.6, lat: 41.1 });
    osm.buildIndexes();

    expect(osm.bbox()).toEqual([-9.2, 38.7, -8.6, 41.1]);
    expect(osm.info().bbox).toEqual([-9.2, 38.7, -8.6, 41.1]);
  });

  it("stays null after an empty dataset is transferred and reconstructed", () => {
    const empty = new Osm();
    empty.buildIndexes();

    expect(new Osm(empty.transferables()).bbox()).toBeNull();
  });
});
