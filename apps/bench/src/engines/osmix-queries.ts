/**
 * The Osmix side of each query. These run inside an Osmix worker (see
 * `workers/osmix-bench.worker.ts`) against the worker's `Osm` instance.
 */

import { haversineDistance } from "@osmix/geo/haversine-distance";
import { clipPolyline } from "@osmix/geo/lineclip";
import { llToTilePx } from "@osmix/geo/tile";
import type { GeoBbox2D, LonLat, XY } from "@osmix/types";
import { type Osm, writeVtPbf } from "osmix";

import {
  NEAREST_MAX_RADIUS_M,
  NEAREST_RADIUS_GROWTH,
  NEAREST_START_RADIUS_M,
  type QueryResult,
  type QuerySpec,
  TILE_BUFFER,
  TILE_EXTENT,
} from "./types";

function idsOf(indexes: number[], idAt: (index: number) => number): Float64Array {
  const ids = new Float64Array(indexes.length);
  for (let i = 0; i < indexes.length; i++) ids[i] = idAt(indexes[i] as number);
  return ids;
}

/** Ways whose line geometry, not only their bbox, touches `bbox`. */
function waysIntersectingExactly(osm: Osm, bbox: GeoBbox2D): number[] {
  const matches: number[] = [];
  for (const index of osm.ways.intersects(bbox)) {
    const [minX, minY, maxX, maxY] = osm.ways.getEntityBbox({ index });
    const inside = minX >= bbox[0] && minY >= bbox[1] && maxX <= bbox[2] && maxY <= bbox[3];
    if (inside) {
      matches.push(index);
      continue;
    }
    const line = osm.ways.getResolvedCoordinates(index);
    if (line.length >= 2 && clipPolyline(line, bbox).length > 0) matches.push(index);
  }
  return matches;
}

/**
 * The k nearest nodes by haversine distance, ties broken by id. The KD index answers radius
 * queries, so the search widens the radius until it holds k nodes.
 */
function nearestNodes(osm: Osm, lon: number, lat: number, k: number): number[] {
  let radiusM = NEAREST_START_RADIUS_M;
  const search = () => {
    const radiusKm = radiusM >= NEAREST_MAX_RADIUS_M ? Number.POSITIVE_INFINITY : radiusM / 1000;
    return osm.nodes.findIndexesWithinRadius(lon, lat, radiusKm);
  };
  let indexes = search();
  while (indexes.length < k && radiusM < NEAREST_MAX_RADIUS_M) {
    radiusM *= NEAREST_RADIUS_GROWTH;
    indexes = search();
  }
  const ranked = indexes.map((index) => ({
    id: osm.nodes.ids.at(index),
    distance: haversineDistance([lon, lat], osm.nodes.getNodeLonLat({ index })),
  }));
  ranked.sort((a, b) => a.distance - b.distance || a.id - b.id);
  return ranked.slice(0, k).map((node) => node.id);
}

function aggregateTagValues(osm: Osm, key: string): { values: string[]; counts: number[] } {
  const { tags } = osm.ways;
  const counts = new Map<string, number>();
  for (const index of tags.hasKey(tags.find(key))) {
    const value = tags.getTags(index)?.[key];
    if (value === undefined) continue;
    const text = String(value);
    counts.set(text, (counts.get(text) ?? 0) + 1);
  }
  return { values: Array.from(counts.keys()), counts: Array.from(counts.values()) };
}

function feature(id: number, osmType: string, geometry: object, properties: object) {
  return JSON.stringify({ type: "Feature", id, osm_type: osmType, geometry, properties });
}

/** Tagged nodes as Points and every way with at least two coordinates as a LineString. */
function toGeoJSON(osm: Osm): string {
  const features: string[] = [];
  const { nodes, ways } = osm;
  for (const index of nodes.tags.taggedEntityIndexes()) {
    const coordinates = nodes.getNodeLonLat({ index });
    const properties = nodes.tags.getTags(index) ?? {};
    features.push(feature(nodes.ids.at(index), "node", { type: "Point", coordinates }, properties));
  }
  for (let index = 0; index < ways.size; index++) {
    const coordinates = ways.getResolvedCoordinates(index);
    if (coordinates.length < 2) continue;
    const properties = ways.tags.getTags(index) ?? {};
    features.push(
      feature(ways.ids.at(index), "way", { type: "LineString", coordinates }, properties),
    );
  }
  return `{"type":"FeatureCollection","features":[${features.join(",")}]}`;
}

function* each<T>(items: T[]): Generator<T> {
  yield* items;
}

function roundPoint([x, y]: XY): XY {
  return [Math.round(x), Math.round(y)];
}

function dedupe(points: XY[]): XY[] {
  return points.filter(
    (p, i) => i === 0 || p[0] !== points[i - 1]?.[0] || p[1] !== points[i - 1]?.[1],
  );
}

/**
 * A two-layer vector tile: tagged nodes and tagged ways as lines, with feature ids and no
 * properties. It mirrors the DuckDB tile SQL, so it skips the area and relation handling
 * that `OsmixVtEncoder` adds for map rendering.
 */
function toTile(osm: Osm, tile: [number, number, number], bbox: GeoBbox2D): ArrayBuffer {
  const project = (ll: LonLat) => llToTilePx(ll, tile, TILE_EXTENT);
  const clipBox: GeoBbox2D = [
    -TILE_BUFFER,
    -TILE_BUFFER,
    TILE_EXTENT + TILE_BUFFER,
    TILE_EXTENT + TILE_BUFFER,
  ];
  const { nodes, ways } = osm;

  const nodeFeatures = nodes.findTaggedIndexesWithinBbox(bbox).map((index) => ({
    id: nodes.ids.at(index),
    type: 1 as const,
    properties: {},
    geometry: [[roundPoint(project(nodes.getNodeLonLat({ index })))]],
  }));

  const wayFeatures = [];
  for (const index of ways.intersects(bbox)) {
    if (ways.tags.cardinality(index) === 0) continue;
    const line = ways.getResolvedCoordinates(index);
    if (line.length < 2) continue;
    const geometry: XY[][] = [];
    for (const segment of clipPolyline(line.map(project), clipBox)) {
      const points = dedupe(segment.map(roundPoint));
      if (points.length >= 2) geometry.push(points);
    }
    if (geometry.length === 0) continue;
    wayFeatures.push({ id: ways.ids.at(index), type: 2 as const, properties: {}, geometry });
  }

  return writeVtPbf([
    { name: "nodes", version: 2, extent: TILE_EXTENT, features: each(nodeFeatures) },
    { name: "ways", version: 2, extent: TILE_EXTENT, features: each(wayFeatures) },
  ]);
}

/** Run one query against an `Osm` instance. */
export function runOsmixQuery(osm: Osm, spec: QuerySpec): QueryResult {
  const nodeId = (index: number) => osm.nodes.ids.at(index);
  const wayId = (index: number) => osm.ways.ids.at(index);
  switch (spec.kind) {
    case "bbox-nodes":
      return { kind: "ids", ids: idsOf(osm.nodes.findIndexesWithinBbox(spec.bbox), nodeId) };
    case "bbox-way-candidates":
      return { kind: "ids", ids: idsOf(osm.ways.intersects(spec.bbox), wayId) };
    case "bbox-ways-exact":
      return { kind: "ids", ids: idsOf(waysIntersectingExactly(osm, spec.bbox), wayId) };
    case "knn":
      return { kind: "ids", ids: Float64Array.from(nearestNodes(osm, spec.lon, spec.lat, spec.k)) };
    case "tag-filter": {
      const { tags } = osm.ways;
      return { kind: "ids", ids: idsOf(tags.hasKey(tags.find(spec.key)), wayId) };
    }
    case "tag-aggregate":
      return { kind: "groups", ...aggregateTagValues(osm, spec.key) };
    case "geojson":
      return { kind: "geojson", text: toGeoJSON(osm) };
    case "tile":
      return { kind: "tile", bytes: new Uint8Array(toTile(osm, spec.tile, spec.bbox)) };
  }
}

/** Buffers in a result that can move to the main thread without a copy. */
export function resultTransferables(result: QueryResult): ArrayBuffer[] {
  if (result.kind === "ids") return [result.ids.buffer as ArrayBuffer];
  if (result.kind === "tile") return [result.bytes.buffer as ArrayBuffer];
  return [];
}
