import { clipPolygon, clipPolyline } from "@osmix/geo/lineclip";
import { wayIsArea } from "@osmix/geo/way-is-area";
import type { ShortbreadGeometryType } from "@osmix/shortbread";
import earcut from "earcut";
import { OsmixRasterTile, type LonLat, type Osm, type Rgba, type Tile, type XY } from "osmix";

import { resolveFeatureStyles, type MapFeatureStyle, type PointFeatureStyle } from "./map-style.ts";
import type {
  StyledTileFeatureIndexProviders,
  StyledTileNodeIndexProvider,
} from "./styled-tile.ts";

export interface VectorGeometryGroup {
  category: "node" | "relation" | "way";
  order: number;
  color: Rgba;
  positions: ArrayBuffer;
  indices: ArrayBuffer;
  sourceEntityIds: number[];
}

export interface VectorTilePacket {
  tile: Tile;
  groups: VectorGeometryGroup[];
}

interface MutableGeometryGroup {
  category: "node" | "relation" | "way";
  color: Rgba;
  indices: number[];
  order: number;
  positions: number[];
  sourceEntityIds: Set<number>;
}

function colorKey(color: Rgba): string {
  return color.join(",");
}

function addVertex(group: MutableGeometryGroup, point: XY): number {
  const index = group.positions.length / 3;
  group.positions.push(point[0], point[1], 0);
  return index;
}

function addQuad(group: MutableGeometryGroup, a: XY, b: XY, c: XY, d: XY): void {
  const start = addVertex(group, a);
  addVertex(group, b);
  addVertex(group, c);
  addVertex(group, d);
  group.indices.push(start, start + 1, start + 2, start, start + 2, start + 3);
}

const ROUND_STROKE_SEGMENTS = 8;

function addRoundStrokePoint(group: MutableGeometryGroup, center: XY, radius: number): void {
  const centerIndex = addVertex(group, center);
  const firstOuterIndex = group.positions.length / 3;
  for (let index = 0; index < ROUND_STROKE_SEGMENTS; index++) {
    const angle = (index / ROUND_STROKE_SEGMENTS) * Math.PI * 2;
    addVertex(group, [center[0] + Math.cos(angle) * radius, center[1] + Math.sin(angle) * radius]);
  }
  for (let index = 0; index < ROUND_STROKE_SEGMENTS; index++) {
    group.indices.push(
      centerIndex,
      firstOuterIndex + index,
      firstOuterIndex + ((index + 1) % ROUND_STROKE_SEGMENTS),
    );
  }
}

function cleanRing(ring: XY[]): XY[] {
  const cleaned: XY[] = [];
  for (const point of ring) {
    const previous = cleaned.at(-1);
    if (previous?.[0] === point[0] && previous[1] === point[1]) continue;
    cleaned.push(point);
  }
  if (cleaned.length > 1) {
    const first = cleaned[0]!;
    const last = cleaned.at(-1)!;
    if (first[0] === last[0] && first[1] === last[1]) cleaned.pop();
  }
  return cleaned.length >= 3 ? cleaned : [];
}

function projectedRings(tile: OsmixRasterTile, rings: LonLat[][]): XY[][] {
  const result: XY[][] = [];
  for (const ring of rings) {
    const projected = ring.map((point) => tile.llToTilePx(point));
    const clipped = cleanRing(clipPolygon(projected, [0, 0, tile.tileSize, tile.tileSize]));
    if (clipped.length > 0) result.push(clipped);
  }
  return result;
}

function addPolygon(
  groups: Map<string, MutableGeometryGroup>,
  tile: OsmixRasterTile,
  rings: LonLat[][],
  style: Extract<MapFeatureStyle, { kind: "fill" }>,
  category: MutableGeometryGroup["category"],
  entityId: number,
): void {
  const clipped = projectedRings(tile, rings);
  const outer = clipped[0];
  if (!outer) return;

  const data: number[] = [];
  const holes: number[] = [];
  for (let ringIndex = 0; ringIndex < clipped.length; ringIndex++) {
    const ring = clipped[ringIndex]!;
    if (ringIndex > 0) holes.push(data.length / 2);
    for (const point of ring) data.push(point[0], point[1]);
  }
  const triangles = earcut(data, holes);
  if (triangles.length === 0) return;

  const key = `fill:${category}:${style.order}:${colorKey(style.color)}`;
  const group = groups.get(key) ?? {
    category,
    color: style.color,
    indices: [],
    order: style.order,
    positions: [],
    sourceEntityIds: new Set(),
  };
  group.sourceEntityIds.add(entityId);
  const offset = group.positions.length / 3;
  for (let index = 0; index < data.length; index += 2) {
    group.positions.push(data[index]!, data[index + 1]!, 0);
  }
  for (const index of triangles) group.indices.push(offset + index);
  groups.set(key, group);
}

function addLine(
  groups: Map<string, MutableGeometryGroup>,
  tile: OsmixRasterTile,
  line: LonLat[],
  color: Rgba,
  width: number,
  order: number,
  category: MutableGeometryGroup["category"],
  entityId: number,
): void {
  const projected = line.map((point) => tile.llToTilePx(point));
  const clipped = clipPolyline(projected, [0, 0, tile.tileSize, tile.tileSize]);
  const key = `line:${category}:${order}:${colorKey(color)}:${width}`;
  const group = groups.get(key) ?? {
    category,
    color,
    indices: [],
    order,
    positions: [],
    sourceEntityIds: new Set(),
  };
  const halfWidth = Math.max(0.5, width / 2);
  const indexCountBefore = group.indices.length;

  for (const segment of clipped) {
    const strokePoints: XY[] = [];
    for (let index = 1; index < segment.length; index++) {
      const a = segment[index - 1]!;
      const b = segment[index]!;
      const dx = b[0] - a[0];
      const dy = b[1] - a[1];
      const length = Math.hypot(dx, dy);
      if (length < 0.001) continue;
      if (strokePoints.length === 0) strokePoints.push(a);
      strokePoints.push(b);
      const nx = (-dy / length) * halfWidth;
      const ny = (dx / length) * halfWidth;
      addQuad(
        group,
        [a[0] + nx, a[1] + ny],
        [b[0] + nx, b[1] + ny],
        [b[0] - nx, b[1] - ny],
        [a[0] - nx, a[1] - ny],
      );
    }
    // Independent quads leave pinholes at bends and blunt, visibly broken road ends. A small
    // triangle fan at each retained vertex creates continuous round joins and caps while keeping
    // every stroke in the same batched material group.
    for (const point of strokePoints) addRoundStrokePoint(group, point, halfWidth);
  }
  if (group.indices.length > indexCountBefore) group.sourceEntityIds.add(entityId);
  groups.set(key, group);
}

function addPoint(
  groups: Map<string, MutableGeometryGroup>,
  tile: OsmixRasterTile,
  point: LonLat,
  style: PointFeatureStyle,
  category: MutableGeometryGroup["category"],
  entityId: number,
): void {
  const center = tile.llToTilePx(point);
  const size = Math.max(1, style.size);
  const key = `point:${category}:${style.order}:${colorKey(style.color)}:${style.symbol}:${size}`;
  const group = groups.get(key) ?? {
    category,
    color: style.color,
    indices: [],
    order: style.order,
    positions: [],
    sourceEntityIds: new Set(),
  };
  group.sourceEntityIds.add(entityId);

  if (style.symbol === "diamond") {
    const top: XY = [center[0], center[1] - size];
    const right: XY = [center[0] + size, center[1]];
    const bottom: XY = [center[0], center[1] + size];
    const left: XY = [center[0] - size, center[1]];
    const start = addVertex(group, top);
    addVertex(group, right);
    addVertex(group, bottom);
    addVertex(group, left);
    group.indices.push(start, start + 1, start + 2, start, start + 2, start + 3);
  } else if (style.symbol === "plus") {
    addQuad(
      group,
      [center[0] - size / 3, center[1] - size],
      [center[0] + size / 3, center[1] - size],
      [center[0] + size / 3, center[1] + size],
      [center[0] - size / 3, center[1] + size],
    );
    addQuad(
      group,
      [center[0] - size, center[1] - size / 3],
      [center[0] + size, center[1] - size / 3],
      [center[0] + size, center[1] + size / 3],
      [center[0] - size, center[1] + size / 3],
    );
  } else if (style.symbol === "ring") {
    const outer = size;
    const inner = Math.max(0.5, size - 1);
    addQuad(
      group,
      [center[0] - outer, center[1] - outer],
      [center[0] + outer, center[1] - outer],
      [center[0] + outer, center[1] - inner],
      [center[0] - outer, center[1] - inner],
    );
    addQuad(
      group,
      [center[0] - outer, center[1] + inner],
      [center[0] + outer, center[1] + inner],
      [center[0] + outer, center[1] + outer],
      [center[0] - outer, center[1] + outer],
    );
    addQuad(
      group,
      [center[0] - outer, center[1] - inner],
      [center[0] - inner, center[1] - inner],
      [center[0] - inner, center[1] + inner],
      [center[0] - outer, center[1] + inner],
    );
    addQuad(
      group,
      [center[0] + inner, center[1] - inner],
      [center[0] + outer, center[1] - inner],
      [center[0] + outer, center[1] + inner],
      [center[0] + inner, center[1] + inner],
    );
  } else {
    addQuad(
      group,
      [center[0] - size, center[1] - size],
      [center[0] + size, center[1] - size],
      [center[0] + size, center[1] + size],
      [center[0] - size, center[1] + size],
    );
  }
  groups.set(key, group);
}

function addStyles(
  groups: Map<string, MutableGeometryGroup>,
  tile: OsmixRasterTile,
  geometryType: ShortbreadGeometryType,
  geometry: { points?: LonLat[]; lineStrings?: LonLat[][]; rings?: LonLat[][][] },
  styles: MapFeatureStyle[],
  category: MutableGeometryGroup["category"],
  entityId: number,
): void {
  for (const style of styles) {
    if (style.kind === "fill" && geometry.rings) {
      for (const polygon of geometry.rings) {
        addPolygon(groups, tile, polygon, style, category, entityId);
        if (style.outlineColor && style.outlineWidth) {
          for (const ring of polygon)
            addLine(
              groups,
              tile,
              ring,
              style.outlineColor,
              style.outlineWidth,
              style.order,
              category,
              entityId,
            );
        }
      }
    } else if (style.kind === "line") {
      const lines =
        geometryType === "LineString"
          ? (geometry.lineStrings ?? [])
          : (geometry.rings ?? []).flat();
      for (const line of lines) {
        if (style.casingColor && style.casingWidth)
          addLine(
            groups,
            tile,
            line,
            style.casingColor,
            style.casingWidth,
            style.order,
            category,
            entityId,
          );
        addLine(groups, tile, line, style.color, style.width, style.order, category, entityId);
      }
    } else if (style.kind === "point" && geometry.points) {
      for (const point of geometry.points) addPoint(groups, tile, point, style, category, entityId);
    }
  }
}

/** Build one transferable Three.js geometry packet from a visible OSM tile. */
export function buildVectorTile(
  osm: Osm,
  tileIndex: Tile,
  nodeIndexProvider: StyledTileNodeIndexProvider | undefined,
  featureIndexes: StyledTileFeatureIndexProviders,
  isCancelled: () => boolean = () => false,
): VectorTilePacket | null {
  const tile = new OsmixRasterTile({ tile: tileIndex, tileSize: 256 });
  const groups = new Map<string, MutableGeometryGroup>();
  const suppressedAreaWayIds = new Set<number>();
  const relationIndexes = [
    ...(featureIndexes.relations ?? osm.relations).intersects(tile.bbox()),
  ].sort((a, b) => a - b);

  for (const relationIndex of relationIndexes) {
    if (isCancelled()) return null;
    const tags = osm.relations.tags.getTags(relationIndex);
    const relation = osm.relations.getRelationGeometry(relationIndex);
    if (relation.rings) {
      const styles = resolveFeatureStyles(tags ?? {}, "Polygon", tileIndex[2]);
      addStyles(
        groups,
        tile,
        "Polygon",
        relation,
        styles,
        "relation",
        osm.relations.ids.at(relationIndex),
      );
      for (const member of osm.relations.getMembersByIndex(relationIndex)) {
        if (member.type === "way") suppressedAreaWayIds.add(member.ref);
      }
    }
    if (relation.lineStrings)
      addStyles(
        groups,
        tile,
        "LineString",
        relation,
        resolveFeatureStyles(tags ?? {}, "LineString", tileIndex[2]),
        "relation",
        osm.relations.ids.at(relationIndex),
      );
    if (relation.points)
      addStyles(
        groups,
        tile,
        "Point",
        relation,
        resolveFeatureStyles(tags ?? {}, "Point", tileIndex[2]),
        "relation",
        osm.relations.ids.at(relationIndex),
      );
  }

  const wayIndexes = [...(featureIndexes.ways ?? osm.ways).intersects(tile.bbox())].sort(
    (a, b) => a - b,
  );
  for (const wayIndex of wayIndexes) {
    if (isCancelled()) return null;
    const tags = osm.ways.tags.getTags(wayIndex);
    if (!tags) continue;
    const id = osm.ways.ids.at(wayIndex);
    const coordinates = osm.ways.getCoordinates(wayIndex);
    const isArea = wayIsArea({ id, refs: osm.ways.getRefIds(wayIndex), tags });
    if (isArea && id !== undefined && suppressedAreaWayIds.has(id)) continue;
    const geometryType = isArea ? "Polygon" : "LineString";
    const styles = resolveFeatureStyles(tags, geometryType, tileIndex[2]);
    addStyles(
      groups,
      tile,
      geometryType,
      isArea ? { rings: [[coordinates]] } : { lineStrings: [coordinates] },
      styles,
      "way",
      id,
    );
  }

  if (tileIndex[2] >= 14) {
    const nodeIndexes = nodeIndexProvider
      ? nodeIndexProvider.findIndexesWithinBbox(tile.bbox())
      : osm.nodes.findIndexesWithinBbox(tile.bbox());
    for (const nodeIndex of [...nodeIndexes].sort((a, b) => a - b)) {
      if (isCancelled()) return null;
      const tags = osm.nodes.tags.getTags(nodeIndex);
      const styles = resolveFeatureStyles(tags ?? {}, "Point", tileIndex[2]);
      if (styles.length > 0)
        addStyles(
          groups,
          tile,
          "Point",
          { points: [osm.nodes.getNodeLonLat({ index: nodeIndex })] },
          styles,
          "node",
          osm.nodes.ids.at(nodeIndex),
        );
    }
  }

  return {
    tile: tileIndex,
    groups: [...groups.values()]
      .filter((group) => group.indices.length > 0)
      .sort((a, b) => a.order - b.order)
      .map((group) => ({
        category: group.category,
        color: group.color,
        indices: Uint32Array.from(group.indices).buffer,
        order: group.order,
        positions: Float32Array.from(group.positions).buffer,
        sourceEntityIds: [...group.sourceEntityIds],
      })),
  };
}
