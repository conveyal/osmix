import { fromPbf, merge, Osm, toPbfBuffer } from "../src/index.ts";

function complete(osm: Osm): Osm {
  osm.buildIndexes();
  osm.buildSpatialIndexes();
  return osm;
}

export function createSyntheticRoutingBase(): Osm {
  const osm = new Osm({ id: "synthetic-routing-base" });

  for (const node of [
    { id: 1, lon: 0, lat: 0 },
    { id: 2, lon: 0, lat: 0.001 },
    { id: 3, lon: 0.003, lat: 0.001 },
    { id: 10, lon: 0, lat: 0.01 },
    { id: 11, lon: 0.001, lat: 0.01 },
    { id: 12, lon: 0.002, lat: 0.01 },
    { id: 13, lon: 0, lat: 0.012 },
    { id: 14, lon: 0.001, lat: 0.012 },
    { id: 15, lon: 0.002, lat: 0.012 },
    { id: 20, lon: 0.004, lat: 0 },
    { id: 21, lon: 0.005, lat: 0 },
    { id: 22, lon: 0.006, lat: 0 },
    { id: 40, lon: 0, lat: 0.02 },
    { id: 41, lon: 0.004, lat: 0.02 },
    { id: 60, lon: 0, lat: 0.03 },
    { id: 61, lon: 0.004, lat: 0.03 },
    { id: 70, lon: 0, lat: 0.04 },
    { id: 72, lon: 0.002, lat: 0.04 },
    { id: 73, lon: 0.001, lat: 0.041 },
  ]) {
    osm.nodes.addNode(node);
  }

  osm.ways.addWay({
    id: 100,
    refs: [1, 2, 3],
    tags: { highway: "residential", name: "Base Road" },
  });
  osm.ways.addWay({
    id: 110,
    refs: [10, 11, 12],
    tags: { highway: "residential", name: "One Way", oneway: "yes" },
  });
  osm.ways.addWay({
    id: 111,
    refs: [13, 14, 15],
    tags: { highway: "residential", name: "Reverse One Way", oneway: "-1" },
  });
  osm.ways.addWay({
    id: 120,
    refs: [20, 21, 22],
    tags: { highway: "residential", layer: "0", name: "Surface Road" },
  });
  osm.ways.addWay({
    id: 130,
    refs: [40, 41],
    tags: { highway: "residential", name: "Crossing Base Road" },
  });
  osm.ways.addWay({
    id: 140,
    refs: [61, 60],
    tags: { highway: "residential", name: "Reverse Base Road" },
  });
  osm.ways.addWay({
    id: 151,
    refs: [70, 73, 72],
    tags: { highway: "residential", name: "Public Detour" },
  });

  return complete(osm);
}

export function createSyntheticRoutingPatch(): Osm {
  const osm = new Osm({ id: "synthetic-routing-patch" });

  for (const node of [
    { id: 1, lon: 0, lat: 0 },
    // A different ID at the exact base-road endpoint exercises safe cross-input reconciliation.
    { id: 30, lon: 0.003, lat: 0.001 },
    { id: 4, lon: 0.003, lat: 0 },
    { id: 23, lon: 0.005, lat: 0.000003 },
    { id: 24, lon: 0.005, lat: -0.001 },
    { id: 25, lon: 0.005, lat: 0.001 },
    { id: 50, lon: 0.002, lat: 0.019 },
    { id: 51, lon: 0.002, lat: 0.021 },
    { id: 62, lon: 0.001, lat: 0.029 },
    { id: 63, lon: 0.001, lat: 0.031 },
    { id: 64, lon: 0.003, lat: 0.029 },
    { id: 65, lon: 0.003, lat: 0.031 },
    { id: 70, lon: 0, lat: 0.04 },
    { id: 71, lon: 0.001, lat: 0.04 },
    { id: 72, lon: 0.002, lat: 0.04 },
  ]) {
    osm.nodes.addNode(node);
  }

  osm.ways.addWay({
    id: 101,
    refs: [30, 4],
    tags: { highway: "residential", name: "Patch Extension" },
  });
  osm.ways.addWay({
    id: 102,
    refs: [1, 4],
    tags: { foot: "designated", highway: "footway", motor_vehicle: "no" },
  });
  osm.ways.addWay({
    id: 121,
    refs: [24, 23, 25],
    tags: { highway: "primary", layer: "-1", name: "Tunnel Road", tunnel: "yes" },
  });
  osm.ways.addWay({
    id: 131,
    refs: [50, 51],
    tags: { highway: "residential", name: "Same Grade Crossing" },
  });
  osm.ways.addWay({
    id: 141,
    refs: [62, 63],
    tags: { highway: "residential", name: "First Reverse Crossing" },
  });
  osm.ways.addWay({
    id: 142,
    refs: [64, 65],
    tags: { highway: "residential", name: "Second Reverse Crossing" },
  });
  osm.ways.addWay({
    id: 150,
    refs: [70, 71, 72],
    tags: {
      foot: "designated",
      highway: "residential",
      motor_vehicle: "no",
      name: "Foot-Designated Access Road",
    },
  });
  osm.relations.addRelation({
    id: 200,
    members: [
      { type: "way", ref: 100, role: "from" },
      { type: "node", ref: 30, role: "via" },
      { type: "way", ref: 101, role: "to" },
    ],
    tags: { restriction: "no_left_turn", type: "restriction" },
  });

  return complete(osm);
}

/** A PBF-roundtrippable dead-end extension on Monaco's eastern boundary. */
export function createMonacoRoutingPatch(base: Osm): Osm {
  const sharedBaseNode = base.nodes.getById(7779445520);
  if (!sharedBaseNode) throw Error("Monaco routing patch anchor node is missing");

  const osm = new Osm({ id: "monaco-synthetic-routing-patch" });
  osm.nodes.addNode({ ...sharedBaseNode, id: 13_000_000_001 });
  osm.nodes.addNode({
    id: 13_000_000_002,
    lat: sharedBaseNode.lat,
    lon: sharedBaseNode.lon + 0.001,
  });
  osm.ways.addWay({
    id: 3_000_000_001,
    refs: [13_000_000_001, 13_000_000_002],
    tags: { highway: "service", name: "Synthetic Monaco boundary extension" },
  });
  return complete(osm);
}

export async function roundTripRoutingOsm(osm: Osm, id = `${osm.id}-roundtrip`): Promise<Osm> {
  return fromPbf(await toPbfBuffer(osm), { id });
}

/** Merge PBF-decoded synthetic inputs exactly as the Merge app's all-steps workflow does. */
export async function createMergedSyntheticRoutingOsm(): Promise<Osm> {
  const [base, patch] = await Promise.all([
    roundTripRoutingOsm(createSyntheticRoutingBase()),
    roundTripRoutingOsm(createSyntheticRoutingPatch()),
  ]);
  return merge(base, patch, {
    createIntersections: true,
    deduplicateNodes: true,
    deduplicateWays: true,
    directMerge: true,
  });
}

/**
 * A pair of offset pedestrian networks used to verify explicit fuzzy attachment. The imported
 * endpoint is about 0.56 meters from the base endpoint: close enough for the recommended 1-meter
 * conflation radius, but still disconnected in an ordinary direct merge.
 */
export function createSyntheticConflationRoutingInputs(): { base: Osm; patch: Osm } {
  const base = new Osm({ id: "synthetic-conflation-base" });
  const baseRefs = Array.from({ length: 41 }, (_, step) => {
    const id = step === 0 ? 801 : step === 40 ? 802 : 8_000 + step;
    base.nodes.addNode({
      id,
      lon: -0.001 + (step * 0.001) / 40,
      lat: 0,
      ...(step === 40 ? { tags: { name: "Base endpoint" } } : {}),
    });
    return id;
  });
  for (let step = 0; step < baseRefs.length - 1; step++) {
    base.ways.addWay({
      id: 810 + step,
      refs: [baseRefs[step]!, baseRefs[step + 1]!],
      tags: { highway: "footway", name: `Base sidewalk ${step + 1}` },
    });
  }

  const patch = new Osm({ id: "synthetic-conflation-patch" });
  const patchRefs = Array.from({ length: 41 }, (_, step) => {
    const id = step === 0 ? 901 : step === 40 ? 902 : 9_000 + step;
    patch.nodes.addNode({
      id,
      lon: 0.000005 + (step * 0.000995) / 40,
      lat: 0,
      ...(step === 0 ? { tags: { name: "Imported endpoint", source: "synthetic survey" } } : {}),
    });
    return id;
  });
  for (let step = 0; step < patchRefs.length - 1; step++) {
    patch.ways.addWay({
      id: 910 + step,
      refs: [patchRefs[step]!, patchRefs[step + 1]!],
      tags: { highway: "footway", name: `Imported sidewalk ${step + 1}` },
    });
  }

  return { base: complete(base), patch: complete(patch) };
}

/** Build ordinary, property-only, and network-attached results from the same PBF-decoded inputs. */
export async function createSyntheticConflationRoutingVariants(): Promise<{
  ordinary: Osm;
  propertyTransfer: Osm;
  networkAttachment: Osm;
}> {
  const inputs = createSyntheticConflationRoutingInputs();
  const [base, patch] = await Promise.all([
    roundTripRoutingOsm(inputs.base, "synthetic-conflation-base-pbf"),
    roundTripRoutingOsm(inputs.patch, "synthetic-conflation-patch-pbf"),
  ]);
  const ordinary = await merge(base, patch, { directMerge: true }, () => undefined);
  const propertyTransfer = await merge(
    base,
    patch,
    {
      directMerge: true,
      conflation: {
        propertyKeys: ["name"],
        attachNetwork: false,
      },
    },
    () => undefined,
  );
  const networkAttachment = await merge(
    base,
    patch,
    {
      directMerge: true,
      conflation: {
        propertyKeys: [],
        attachNetwork: true,
      },
    },
    () => undefined,
  );
  return { ordinary, propertyTransfer, networkAttachment };
}
