import { Osm, OsmixWorker } from "osmix";

export function createWayRemovalInputs({ branch = false, taggedNode = false } = {}) {
  const base = new Osm({ id: "removal-base" });
  base.nodes.addNode({ id: 1, lon: 0, lat: 0 });
  base.nodes.addNode({ id: 2, lon: 0.001, lat: 0 });
  base.ways.addWay({ id: 10, refs: [1, 2], tags: { highway: "footway", name: "Base path" } });
  const patch = new Osm({ id: "removal-patch" });
  patch.nodes.addNode({
    id: 101,
    lon: 0,
    lat: 0.000004,
    ...(taggedNode ? { tags: { name: "Retained marker" } } : {}),
  });
  patch.nodes.addNode({ id: 102, lon: 0.001, lat: 0.000004 });
  patch.nodes.addNode({ id: 103, lon: 0.002, lat: 0.000004 });
  patch.ways.addWay({
    id: 20,
    refs: [101, 102],
    tags: { highway: "footway", name: "Imported accessible path" },
  });
  if (branch) patch.ways.addWay({ id: 30, refs: [102, 103], tags: { highway: "footway" } });
  for (const osm of [base, patch]) {
    osm.buildIndexes();
    osm.buildSpatialIndexes();
  }
  return { base, patch };
}

export class WayRemovalReviewWorker extends OsmixWorker {
  add(osm: Osm) {
    this.set(osm.id, osm);
  }

  dataset(id: string) {
    return this.get(id);
  }
}

export function createWayRemovalSession({ branch = false, taggedNode = false } = {}) {
  const { base, patch } = createWayRemovalInputs({ branch, taggedNode });
  const worker = new WayRemovalReviewWorker();
  worker.add(base);
  worker.add(patch);
  worker.discoverConflation(base.id, patch.id, {
    propertyKeys: ["name"],
    attachNetwork: branch,
    allowWayRemoval: true,
    maxDistanceMeters: 1,
  });
  worker.setConflationFilter(base.id, { entityType: "way", sourceId: 20 });
  return { base, patch, worker };
}
