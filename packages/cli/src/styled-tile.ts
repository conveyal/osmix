import { wayIsArea } from "@osmix/geo/way-is-area";
import { runCooperatively } from "@osmix/shared/cooperative";
import type { ShortbreadGeometryType } from "@osmix/shortbread";
import {
  OsmixRasterTile,
  type GeoBbox2D,
  type LonLat,
  type Osm,
  type OsmTags,
  type Rgba,
  type Tile,
  type XY,
} from "osmix";

import {
  resolveFeatureStyles,
  type LineFeatureStyle,
  type MapFeatureStyle,
  type PointFeatureStyle,
} from "./map-style.ts";

interface DrawCommand {
  index: number;
  order: number;
  draw: (rasterTile: OsmixRasterTile) => void;
}

interface StyledTileJob {
  isCancelled: () => boolean;
  iterator: Generator<void, void>;
  rasterTile: OsmixRasterTile;
}

/** Internal scheduling hooks used by the worker's cooperative renderer and its tests. */
export interface StyledTileAsyncOptions {
  chunkBudgetMs?: number;
  now?: () => number;
  yieldToEventLoop?: () => Promise<void>;
}

/** A compact node index may be supplied when the full OSM node index is unavailable. */
export interface StyledTileNodeIndexProvider {
  findIndexesWithinBbox(bbox: GeoBbox2D): Iterable<number>;
}

export interface StyledTileSpatialIndexProvider {
  intersects(bbox: GeoBbox2D): Iterable<number>;
}

export interface StyledTileFeatureIndexProviders {
  relations?: StyledTileSpatialIndexProvider;
  ways?: StyledTileSpatialIndexProvider;
}

function drawLines(
  rasterTile: OsmixRasterTile,
  lineStrings: LonLat[][],
  style: LineFeatureStyle,
): void {
  for (const lineString of lineStrings) {
    if (style.casingColor && style.casingWidth) {
      rasterTile.drawLineString(lineString, style.casingColor, style.casingWidth);
    }
    rasterTile.drawLineString(lineString, style.color, style.width);
  }
}

function drawSymbolPixel(rasterTile: OsmixRasterTile, pixel: XY, color: Rgba): void {
  if (
    pixel[0] < 0 ||
    pixel[0] >= rasterTile.tileSize ||
    pixel[1] < 0 ||
    pixel[1] >= rasterTile.tileSize
  ) {
    return;
  }
  rasterTile.drawPixel(pixel, color);
}

function drawPointSymbol(
  rasterTile: OsmixRasterTile,
  point: LonLat,
  style: PointFeatureStyle,
): void {
  const center = rasterTile.clampAndRoundPx(rasterTile.llToTilePx(point));
  if (style.symbol === "dot") {
    rasterTile.drawPoint(point, style.color, style.size - 1);
    return;
  }

  for (let y = -style.size; y <= style.size; y++) {
    for (let x = -style.size; x <= style.size; x++) {
      const absoluteX = Math.abs(x);
      const absoluteY = Math.abs(y);
      const shouldDraw =
        (style.symbol === "diamond" && absoluteX + absoluteY <= style.size) ||
        (style.symbol === "plus" && (x === 0 || y === 0)) ||
        style.symbol === "square" ||
        (style.symbol === "ring" && Math.max(absoluteX, absoluteY) === style.size);
      if (shouldDraw) {
        drawSymbolPixel(rasterTile, [center[0] + x, center[1] + y], style.color);
      }
    }
  }
}

function addPolygonCommands(
  commands: DrawCommand[],
  polygons: LonLat[][][],
  styles: MapFeatureStyle[],
): void {
  for (const style of styles) {
    if (style.kind === "fill") {
      for (const polygon of polygons) {
        commands.push({
          draw: (tile) => tile.drawPolygon(polygon, style.color),
          index: commands.length,
          order: style.order,
        });
      }
      if (!style.outlineColor || !style.outlineWidth) continue;
      for (const polygon of polygons) {
        for (const ring of polygon) {
          commands.push({
            draw: (tile) => tile.drawLineString(ring, style.outlineColor, style.outlineWidth),
            index: commands.length,
            order: style.order,
          });
        }
      }
    } else if (style.kind === "line") {
      for (const polygon of polygons) {
        for (const ring of polygon) {
          commands.push({
            draw: (tile) => drawLines(tile, [ring], style),
            index: commands.length,
            order: style.order,
          });
        }
      }
    }
  }
}

function addLineCommands(
  commands: DrawCommand[],
  lineStrings: LonLat[][],
  styles: MapFeatureStyle[],
): void {
  for (const style of styles) {
    if (style.kind !== "line") continue;
    for (const lineString of lineStrings) {
      commands.push({
        draw: (tile) => drawLines(tile, [lineString], style),
        index: commands.length,
        order: style.order,
      });
    }
  }
}

function addPointCommands(
  commands: DrawCommand[],
  points: LonLat[],
  styles: MapFeatureStyle[],
): void {
  for (const style of styles) {
    if (style.kind !== "point") continue;
    for (const point of points) {
      commands.push({
        draw: (tile) => drawPointSymbol(tile, point, style),
        index: commands.length,
        order: style.order,
      });
    }
  }
}

function geometryStyles(
  tags: OsmTags | undefined,
  geometryType: ShortbreadGeometryType,
  zoom: number,
): MapFeatureStyle[] {
  if (!tags || Object.keys(tags).length === 0) return [];
  return resolveFeatureStyles(tags, geometryType, zoom);
}

function createStyledTileJob(
  osm: Osm,
  tile: Tile,
  tileSize: number,
  nodeIndexProvider: StyledTileNodeIndexProvider | undefined,
  featureIndexes: StyledTileFeatureIndexProviders,
  isCancelled: () => boolean,
): StyledTileJob {
  const rasterTile = new OsmixRasterTile({ tile, tileSize });
  return {
    isCancelled,
    iterator: collectAndDrawTileSteps(
      osm,
      rasterTile,
      nodeIndexProvider,
      featureIndexes,
      isCancelled,
    ),
    rasterTile,
  };
}

function* collectAndDrawTileSteps(
  osm: Osm,
  rasterTile: OsmixRasterTile,
  nodeIndexProvider: StyledTileNodeIndexProvider | undefined,
  featureIndexes: StyledTileFeatureIndexProviders,
  isCancelled: () => boolean,
): Generator<void, void> {
  const bbox = rasterTile.bbox();
  const zoom = rasterTile.tile[2];
  const commands: DrawCommand[] = [];
  const suppressedAreaWayIds = new Set<number>();
  const relationIndexes = [...(featureIndexes.relations ?? osm.relations).intersects(bbox)].sort(
    (a, b) => a - b,
  );

  for (const relationIndex of relationIndexes) {
    if (isCancelled()) return;
    const tags = osm.relations.tags.getTags(relationIndex);
    const polygonStyles = geometryStyles(tags, "Polygon", zoom);
    const lineStyles = geometryStyles(tags, "LineString", zoom);
    const pointStyles = geometryStyles(tags, "Point", zoom);
    if (polygonStyles.length === 0 && lineStyles.length === 0 && pointStyles.length === 0) {
      yield;
      continue;
    }
    const geometry = osm.relations.getRelationGeometry(relationIndex);
    if (geometry.rings) {
      if (polygonStyles.length > 0) {
        for (const member of osm.relations.getMembersByIndex(relationIndex)) {
          if (member.type === "way") suppressedAreaWayIds.add(member.ref);
        }
        addPolygonCommands(commands, geometry.rings, polygonStyles);
      }
    }
    if (geometry.lineStrings) {
      addLineCommands(commands, geometry.lineStrings, lineStyles);
    }
    if (geometry.points) {
      addPointCommands(commands, geometry.points, pointStyles);
    }
    yield;
  }

  const wayIndexes = [...(featureIndexes.ways ?? osm.ways).intersects(bbox)].sort((a, b) => a - b);
  for (const wayIndex of wayIndexes) {
    if (isCancelled()) return;
    const tags = osm.ways.tags.getTags(wayIndex);
    if (!tags || Object.keys(tags).length === 0) {
      yield;
      continue;
    }
    const polygonStyles = geometryStyles(tags, "Polygon", zoom);
    const lineStyles = geometryStyles(tags, "LineString", zoom);
    if (polygonStyles.length === 0 && lineStyles.length === 0) {
      yield;
      continue;
    }
    const way = osm.ways.getFullEntity(wayIndex, osm.ways.ids.at(wayIndex), tags);
    const isArea = wayIsArea(way);
    if (isArea && suppressedAreaWayIds.has(way.id)) {
      yield;
      continue;
    }
    const styles = isArea ? polygonStyles : lineStyles;
    if (styles.length === 0) {
      yield;
      continue;
    }
    const coordinates = osm.ways.getCoordinates(wayIndex);
    if (isArea) {
      addPolygonCommands(commands, [[coordinates]], styles);
    } else {
      addLineCommands(commands, [coordinates], styles);
    }
    yield;
  }

  if (zoom >= 14) {
    const nodeIndexes = nodeIndexProvider
      ? nodeIndexProvider.findIndexesWithinBbox(bbox)
      : osm.nodes.findIndexesWithinBbox(bbox);
    for (const nodeIndex of [...nodeIndexes].sort((a, b) => a - b)) {
      if (isCancelled()) return;
      const tags = osm.nodes.tags.getTags(nodeIndex);
      const styles = geometryStyles(tags, "Point", zoom);
      if (styles.length > 0) {
        addPointCommands(commands, [osm.nodes.getNodeLonLat({ index: nodeIndex })], styles);
      }
      yield;
    }
  }

  commands.sort((a, b) => a.order - b.order || a.index - b.index);
  for (const command of commands) {
    if (isCancelled()) return;
    command.draw(rasterTile);
    yield;
  }
}

function currentTimeMs(): number {
  return globalThis.performance?.now() ?? Date.now();
}

function runStyledTileChunk(job: StyledTileJob, chunkBudgetMs: number, now: () => number): boolean {
  if (job.isCancelled()) {
    job.iterator.return();
    return true;
  }
  const startedAt = now();
  do {
    if (job.isCancelled()) {
      job.iterator.return();
      return true;
    }
    if (job.iterator.next().done) return true;
  } while (now() - startedAt < chunkBudgetMs);
  return false;
}

/** Render one semantic dark-basemap XYZ tile from an indexed OSM dataset. */
export function drawStyledMapTile(
  osm: Osm,
  tile: Tile,
  tileSize = 256,
  nodeIndexProvider?: StyledTileNodeIndexProvider,
  featureIndexes: StyledTileFeatureIndexProviders = {},
  isCancelled: () => boolean = () => false,
): OsmixRasterTile {
  const job = createStyledTileJob(
    osm,
    tile,
    tileSize,
    nodeIndexProvider,
    featureIndexes,
    isCancelled,
  );
  runStyledTileChunk(job, Number.POSITIVE_INFINITY, currentTimeMs);
  return job.rasterTile;
}

/** Worker-only renderer that yields between bounded chunks so cancellation RPCs can run. */
export async function drawStyledMapTileAsync(
  osm: Osm,
  tile: Tile,
  tileSize = 256,
  nodeIndexProvider?: StyledTileNodeIndexProvider,
  featureIndexes: StyledTileFeatureIndexProviders = {},
  isCancelled: () => boolean = () => false,
  options: StyledTileAsyncOptions = {},
): Promise<OsmixRasterTile> {
  const job = createStyledTileJob(
    osm,
    tile,
    tileSize,
    nodeIndexProvider,
    featureIndexes,
    isCancelled,
  );
  await runCooperatively(job.iterator, {
    isCancelled,
    now: options.now,
    timeSliceMs: options.chunkBudgetMs,
    yieldToEventLoop: options.yieldToEventLoop,
  });
  return job.rasterTile;
}
