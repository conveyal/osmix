import { Osm } from "./osm.ts";

/** Old ID → new ID for each renumbered entity, by type. JSON- and structured-clone-safe. */
export interface OsmIdMap {
  nodes: Record<number, number>;
  ways: Record<number, number>;
  relations: Record<number, number>;
}

/** New positive IDs for one type's negative IDs, after its highest positive ID, in −1, −2, … order. */
function positiveIds(ids: { size: number; at(index: number): number }): Map<number, number> {
  let max = 0;
  const negative: number[] = [];
  for (let index = 0; index < ids.size; index++) {
    const id = ids.at(index);
    if (id < 0) negative.push(id);
    else max = Math.max(max, id);
  }
  negative.sort((a, b) => b - a);
  return new Map(negative.map((id, index) => [id, max + index + 1]));
}

/**
 * A copy of `osm` whose negative node, way and relation IDs are replaced by positive ones, for
 * tools that reject negative IDs. In OSM files a negative ID conventionally marks a new, not yet
 * uploaded entity, so only do this when the consumer needs it. Each type gets IDs after its own
 * highest positive ID, in −1, −2, … order, so the result is deterministic. Way refs and relation
 * members follow. `osm` is unchanged; the copy has its indexes built.
 */
export function renumberNegativeIds(osm: Osm, options: { id?: string } = {}) {
  const nodeIds = positiveIds(osm.nodes.ids);
  const wayIds = positiveIds(osm.ways.ids);
  const relationIds = positiveIds(osm.relations.ids);
  const mapped = { node: nodeIds, way: wayIds, relation: relationIds } as const;
  const renumbered = new Osm({ id: options.id ?? osm.id, header: osm.header });
  for (const node of osm.nodes.sorted()) {
    renumbered.nodes.addNode({ ...node, id: nodeIds.get(node.id) ?? node.id });
  }
  for (const way of osm.ways.sorted()) {
    renumbered.ways.addWay({
      ...way,
      id: wayIds.get(way.id) ?? way.id,
      refs: way.refs.map((ref) => nodeIds.get(ref) ?? ref),
    });
  }
  for (const relation of osm.relations.sorted()) {
    renumbered.relations.addRelation({
      ...relation,
      id: relationIds.get(relation.id) ?? relation.id,
      members: relation.members.map((member) => ({
        ...member,
        ref: mapped[member.type].get(member.ref) ?? member.ref,
      })),
    });
  }
  renumbered.buildIndexes();
  renumbered.buildSpatialIndexes();
  return { osm: renumbered, idMap: toIdMap(nodeIds, wayIds, relationIds) };
}

function toIdMap(
  nodes: Map<number, number>,
  ways: Map<number, number>,
  relations: Map<number, number>,
): OsmIdMap {
  return {
    nodes: Object.fromEntries(nodes),
    ways: Object.fromEntries(ways),
    relations: Object.fromEntries(relations),
  };
}

/** The ID map `renumberNegativeIds(osm)` would apply, without copying the data. */
export function negativeIdMap(osm: Osm): OsmIdMap {
  return toIdMap(
    positiveIds(osm.nodes.ids),
    positiveIds(osm.ways.ids),
    positiveIds(osm.relations.ids),
  );
}
