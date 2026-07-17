/**
 * Shortbread Vector Tile Encoder
 * Encodes OSM data into vector tiles following the Shortbread schema
 * Based on https://shortbread-tiles.org/schema/1.0/
 */

import type { OsmReader } from "@osmix/core/contracts";
import { bboxContainsOrIntersects } from "@osmix/geo/bbox-intersects";
import { clipPolygon, clipPolyline } from "@osmix/geo/lineclip";
import { llToTilePx, tileToBbox } from "@osmix/geo/tile";
import { wayIsArea } from "@osmix/geo/way-is-area";
import type { GeoBbox2D, LonLat, Tile, XY } from "@osmix/types";
import {
  type VtSimpleFeature,
  type VtSimpleFeatureGeometry,
  type VtSimpleFeatureType,
  writeVtPbf,
} from "@osmix/vt";

import {
  shortbreadFeatureHasLayer,
  type ShortbreadFeatureIndex,
  type ShortbreadFeatureRecord,
} from "./feature-index.ts";
import { matchTags, SHORTBREAD_LAYERS } from "./layers.ts";
import type { ShortbreadLayerName, ShortbreadProperties } from "./types.ts";

const DEFAULT_EXTENT = 4096;
const DEFAULT_BUFFER = 64;

/** Named construction options for indexed or custom-extent Shortbread encoding. */
export interface ShortbreadVtEncoderOptions {
  buffer?: number;
  extent?: number;
  featureIndex?: ShortbreadFeatureIndex;
}

const SF_TYPE: VtSimpleFeatureType = {
  POINT: 1,
  LINE: 2,
  POLYGON: 3,
};

const clamp = (value: number, min: number, max: number) => Math.min(Math.max(value, min), max);

function dedupePoints(points: XY[]): XY[] {
  if (points.length < 2) return points;
  const result: XY[] = [];
  let lastPoint: XY = [Number.NaN, Number.NaN];
  for (const point of points) {
    if (point[0] === lastPoint[0] && point[1] === lastPoint[1]) continue;
    result.push(point);
    lastPoint = point;
  }
  return result;
}

// Signed area via shoelace formula.
// Positive area => CCW, Negative => CW.
function ringArea(ring: XY[]): number {
  let sum = 0;
  for (let i = 0; i < ring.length - 1; i++) {
    const [x1, y1] = ring[i]!;
    const [x2, y2] = ring[i + 1]!;
    sum += x1 * y2 - x2 * y1;
  }
  return sum / 2;
}

function ensureClockwise(ring: XY[]): XY[] {
  return ringArea(ring) < 0 ? ring : [...ring].reverse();
}

function ensureCounterclockwise(ring: XY[]): XY[] {
  return ringArea(ring) > 0 ? ring : [...ring].reverse();
}

function closeRing(ring: XY[]): XY[] {
  const first = ring[0];
  const last = ring[ring.length - 1];
  if (first === undefined || last === undefined) return ring;
  if (first[0] !== last[0] || first[1] !== last[1]) {
    return [...ring, first];
  }
  return ring;
}

// Remove consecutive duplicates *after* rounding
function cleanRing(ring: XY[]): XY[] {
  const deduped = dedupePoints(ring);
  // After dedupe, we still must ensure closure, and a polygon
  // ring needs at least 4 coords (A,B,C,A).
  const closed = closeRing(deduped);
  if (closed.length < 4) return [];
  return closed;
}

/**
 * Feature ready for layer aggregation
 */
interface ClassifiedFeature {
  id: number;
  layer: ShortbreadLayerName;
  type: VtSimpleFeatureType[keyof VtSimpleFeatureType];
  properties: ShortbreadProperties;
  geometry: VtSimpleFeatureGeometry;
}

interface FeatureCandidate {
  entityIndex: number;
  layerMask?: number;
}

function* unindexedCandidates(indexes: Iterable<number>): Generator<FeatureCandidate> {
  for (const entityIndex of [...indexes].sort((a, b) => a - b)) yield { entityIndex };
}

/**
 * Shortbread-compliant Vector Tile Encoder
 *
 * Generates vector tiles following the Shortbread schema specification.
 * Features are classified into appropriate layers based on their OSM tags.
 */
export class ShortbreadVtEncoder {
  private readonly osm: OsmReader;
  private readonly extent: number;
  private readonly extentBbox: [number, number, number, number];
  private readonly featureIndex: ShortbreadFeatureIndex | undefined;

  /**
   * Create a new Shortbread encoder
   * @param osm - The OSM data source
   * @param extent - Tile extent (default 4096)
   * @param buffer - Buffer size for clipping (default 64)
   * @param featureIndex - Optional preclassified, transferable spatial index
   */
  constructor(osm: OsmReader, options?: ShortbreadVtEncoderOptions);
  constructor(
    osm: OsmReader,
    extent?: number,
    buffer?: number,
    featureIndex?: ShortbreadFeatureIndex,
  );
  constructor(
    osm: OsmReader,
    extentOrOptions: number | ShortbreadVtEncoderOptions = DEFAULT_EXTENT,
    buffer = DEFAULT_BUFFER,
    featureIndex?: ShortbreadFeatureIndex,
  ) {
    const extent =
      typeof extentOrOptions === "number"
        ? extentOrOptions
        : (extentOrOptions.extent ?? DEFAULT_EXTENT);
    const resolvedBuffer =
      typeof extentOrOptions === "number" ? buffer : (extentOrOptions.buffer ?? DEFAULT_BUFFER);
    this.osm = osm;
    this.extent = extent;
    this.featureIndex =
      typeof extentOrOptions === "number" ? featureIndex : extentOrOptions.featureIndex;
    const min = -resolvedBuffer;
    const max = extent + resolvedBuffer;
    this.extentBbox = [min, min, max, max];
  }

  /**
   * Get all Shortbread layer names
   */
  static get layerNames(): ShortbreadLayerName[] {
    return SHORTBREAD_LAYERS.map((l) => l.name);
  }

  /**
   * Generate a vector tile for the given tile coordinates
   */
  getTile(tile: Tile): ArrayBuffer {
    const bbox = tileToBbox(tile);
    const osmBbox = this.osm.bbox();
    if (!bboxContainsOrIntersects(bbox, osmBbox)) {
      return new ArrayBuffer(0);
    }
    return this.getTileForBbox(bbox, (ll) => llToTilePx(ll, tile, this.extent));
  }

  /**
   * Generate a vector tile for the given bounding box
   */
  getTileForBbox(bbox: GeoBbox2D, proj: (ll: LonLat) => XY): ArrayBuffer {
    // Collect features by layer
    const featuresByLayer = new Map<ShortbreadLayerName, ClassifiedFeature[]>();

    // Initialize all layers
    for (const layer of SHORTBREAD_LAYERS) {
      featuresByLayer.set(layer.name, []);
    }

    const indexedRecords = this.featureIndex?.query(bbox);
    const nodeCandidates = this.candidates(indexedRecords, "node");
    const wayCandidates = this.candidates(indexedRecords, "way");
    const relationCandidates = this.candidates(indexedRecords, "relation");
    const classifiedAreaMemberWayLayerMasks = this.featureIndex
      ? null
      : this.classifiedAreaMemberWayLayerMasks(bbox);
    const suppressesWayLayer = (id: number, layer: ShortbreadLayerName): boolean =>
      this.featureIndex?.suppressesWay(id, layer) ??
      this.layerMaskHasLayer(classifiedAreaMemberWayLayerMasks?.get(id) ?? 0, layer);

    // Process nodes (points)
    for (const feature of this.classifyNodes(bbox, proj, nodeCandidates)) {
      const layerFeatures = featuresByLayer.get(feature.layer);
      if (layerFeatures) {
        layerFeatures.push(feature);
      }
    }

    // Process ways (lines and polygons)
    for (const feature of this.classifyWays(bbox, proj, suppressesWayLayer, wayCandidates)) {
      const layerFeatures = featuresByLayer.get(feature.layer);
      if (layerFeatures) {
        layerFeatures.push(feature);
      }
    }

    // Process relations
    for (const feature of this.classifyRelations(bbox, proj, relationCandidates)) {
      const layerFeatures = featuresByLayer.get(feature.layer);
      if (layerFeatures) {
        layerFeatures.push(feature);
      }
    }

    // Build layers array for encoding
    const layers = SHORTBREAD_LAYERS.map((layerDef) => {
      const features = featuresByLayer.get(layerDef.name) ?? [];
      return {
        name: layerDef.name,
        version: 2,
        extent: this.extent,
        features: this.featureGenerator(features),
      };
    }).filter((layer) => {
      // Only include layers with features
      const features = featuresByLayer.get(layer.name as ShortbreadLayerName);
      return features && features.length > 0;
    });

    return writeVtPbf(layers);
  }

  private *featureGenerator(features: ClassifiedFeature[]): Generator<VtSimpleFeature> {
    for (const feature of features) {
      // Filter out undefined properties to ensure valid VT encoding
      // Set the type property to the actual OSM entity type (node/way/relation)
      const cleanProperties: VtSimpleFeature["properties"] = {};
      for (const [key, value] of Object.entries(feature.properties)) {
        if (value !== undefined) {
          // Convert booleans to 0/1 for OsmTags compatibility
          if (typeof value === "boolean") {
            cleanProperties[key] = value ? 1 : 0;
          } else {
            cleanProperties[key] = value;
          }
        }
      }
      yield {
        id: feature.id,
        type: feature.type,
        properties: cleanProperties,
        geometry: feature.geometry,
      };
    }
  }

  /**
   * Classify nodes into Shortbread layers
   */
  private *classifyNodes(
    bbox: GeoBbox2D,
    proj: (ll: LonLat) => XY,
    indexedCandidates?: FeatureCandidate[],
  ): Generator<ClassifiedFeature> {
    const candidates =
      indexedCandidates ?? unindexedCandidates(this.osm.nodes.findIndexesWithinBbox(bbox));

    for (const candidate of candidates) {
      const nodeIndex = candidate.entityIndex;
      const tags = this.osm.nodes.tags.getTags(nodeIndex);
      if (!tags || Object.keys(tags).length === 0) continue;

      const matches = matchTags(tags, "Point");
      if (matches.length === 0) continue;

      const id = this.osm.nodes.ids.at(nodeIndex);
      const ll = this.osm.nodes.getNodeLonLat({ index: nodeIndex });

      const projected = proj(ll);
      for (const match of matches) {
        if (
          candidate.layerMask !== undefined &&
          !shortbreadFeatureHasLayer({ layerMask: candidate.layerMask }, match.layer.name)
        ) {
          continue;
        }
        yield {
          id,
          layer: match.layer.name,
          type: SF_TYPE.POINT,
          properties: match.properties,
          geometry: [[projected]],
        };
      }
    }
  }

  /**
   * Classify ways into Shortbread layers
   */
  private *classifyWays(
    bbox: GeoBbox2D,
    proj: (ll: LonLat) => XY,
    suppressesWayLayer: (id: number, layer: ShortbreadLayerName) => boolean,
    indexedCandidates?: FeatureCandidate[],
  ): Generator<ClassifiedFeature> {
    const candidates = indexedCandidates ?? unindexedCandidates(this.osm.ways.intersects(bbox));

    for (const candidate of candidates) {
      const wayIndex = candidate.entityIndex;
      const id = this.osm.ways.ids.at(wayIndex);

      const tags = this.osm.ways.tags.getTags(wayIndex);
      if (!tags || Object.keys(tags).length === 0) continue;

      const wayLine = this.osm.ways.getCoordinates(wayIndex);
      const points: XY[] = wayLine.map((ll) => proj(ll));

      const isArea = wayIsArea({
        id,
        refs: this.osm.ways.getRefIds(wayIndex),
        tags,
      });

      const geometryType = isArea ? "Polygon" : "LineString";
      const matches = matchTags(tags, geometryType);
      if (matches.length === 0) continue;

      const geometry: VtSimpleFeatureGeometry = [];

      if (isArea) {
        const clippedRings = this.clipProjectedPolygon(points);
        for (let ringIndex = 0; ringIndex < clippedRings.length; ringIndex++) {
          const clippedRing = clippedRings[ringIndex];
          if (!clippedRing) continue;
          const isOuter = ringIndex === 0;
          const processedRing = this.processClippedPolygonRing(clippedRing, isOuter);
          if (processedRing.length > 0) {
            geometry.push(processedRing);
          }
        }
      } else {
        const clippedSegmentsRaw = this.clipProjectedPolyline(points);
        for (const segment of clippedSegmentsRaw) {
          const rounded = segment.map((xy) => this.clampAndRoundPoint(xy));
          const deduped = dedupePoints(rounded);
          if (deduped.length >= 2) {
            geometry.push(deduped);
          }
        }
      }

      if (geometry.length === 0) continue;

      for (const match of matches) {
        if (isArea && suppressesWayLayer(id, match.layer.name)) continue;
        if (
          candidate.layerMask !== undefined &&
          !shortbreadFeatureHasLayer({ layerMask: candidate.layerMask }, match.layer.name)
        ) {
          continue;
        }
        yield {
          id,
          layer: match.layer.name,
          type: isArea ? SF_TYPE.POLYGON : SF_TYPE.LINE,
          properties: match.properties,
          geometry,
        };
      }
    }
  }

  /**
   * Classify relations into Shortbread layers
   */
  private *classifyRelations(
    bbox: GeoBbox2D,
    proj: (ll: LonLat) => XY,
    indexedCandidates?: FeatureCandidate[],
  ): Generator<ClassifiedFeature> {
    const candidates =
      indexedCandidates ?? unindexedCandidates(this.osm.relations.intersects(bbox));

    for (const candidate of candidates) {
      const relIndex = candidate.entityIndex;
      const relation = this.osm.relations.getByIndex(relIndex);
      const relationGeometry = this.osm.relations.getRelationGeometry(relIndex);
      if (
        !relation?.tags ||
        (!relationGeometry.lineStrings && !relationGeometry.rings && !relationGeometry.points)
      )
        continue;

      if (relationGeometry.rings) {
        // Area relations (multipolygon, boundary)
        const matches = matchTags(relation.tags, "Polygon");
        if (matches.length === 0) continue;

        const { rings } = relationGeometry;
        if (rings.length === 0) continue;

        for (const polygon of rings) {
          const geometry: VtSimpleFeatureGeometry = [];

          for (let ringIndex = 0; ringIndex < polygon.length; ringIndex++) {
            const ring = polygon[ringIndex];
            if (!ring || ring.length < 3) continue;

            const projectedRing: XY[] = ring.map((ll: LonLat) => proj(ll));
            const clipped = clipPolygon(projectedRing, this.extentBbox);
            if (clipped.length < 3) continue;

            const isOuter = ringIndex === 0;
            const processedRing = this.processClippedPolygonRing(clipped, isOuter);
            if (processedRing.length > 0) {
              geometry.push(processedRing);
            }
          }

          if (geometry.length === 0) continue;

          for (const match of matches) {
            if (
              candidate.layerMask !== undefined &&
              !shortbreadFeatureHasLayer({ layerMask: candidate.layerMask }, match.layer.name)
            ) {
              continue;
            }
            yield {
              id: relation.id,
              layer: match.layer.name,
              type: SF_TYPE.POLYGON,
              properties: match.properties,
              geometry,
            };
          }
        }
      } else if (relationGeometry.lineStrings) {
        // Line relations (route, multilinestring)
        const matches = matchTags(relation.tags, "LineString");
        if (!matches) continue;

        const { lineStrings } = relationGeometry;
        if (lineStrings.length === 0) continue;

        for (const lineString of lineStrings) {
          const geometry: VtSimpleFeatureGeometry = [];
          const points: XY[] = lineString.map((ll) => proj(ll));
          const clippedSegmentsRaw = this.clipProjectedPolyline(points);

          for (const segment of clippedSegmentsRaw) {
            const rounded = segment.map((xy) => this.clampAndRoundPoint(xy));
            const deduped = dedupePoints(rounded);
            if (deduped.length >= 2) {
              geometry.push(deduped);
            }
          }

          if (geometry.length === 0) continue;

          for (const match of matches) {
            if (
              candidate.layerMask !== undefined &&
              !shortbreadFeatureHasLayer({ layerMask: candidate.layerMask }, match.layer.name)
            ) {
              continue;
            }
            yield {
              id: relation.id,
              layer: match.layer.name,
              type: SF_TYPE.LINE,
              properties: match.properties,
              geometry,
            };
          }
        }
      } else if (relationGeometry.points) {
        // Point relations
        const matches = matchTags(relation.tags, "Point");
        if (!matches) continue;

        const { points } = relationGeometry;
        if (points.length === 0) continue;

        const geometry: VtSimpleFeatureGeometry = [];
        for (const point of points) {
          const projected = proj(point);
          const clamped = this.clampAndRoundPoint(projected);
          geometry.push([clamped]);
        }

        if (geometry.length === 0) continue;

        for (const match of matches) {
          if (
            candidate.layerMask !== undefined &&
            !shortbreadFeatureHasLayer({ layerMask: candidate.layerMask }, match.layer.name)
          ) {
            continue;
          }
          yield {
            id: relation.id,
            layer: match.layer.name,
            type: SF_TYPE.POINT,
            properties: match.properties,
            geometry,
          };
        }
      }
    }
  }

  private candidates(
    records: ShortbreadFeatureRecord[] | undefined,
    entityType: ShortbreadFeatureRecord["entityType"],
  ): FeatureCandidate[] | undefined {
    return records
      ?.filter((record) => record.entityType === entityType)
      .map((record) => ({ entityIndex: record.entityIndex, layerMask: record.layerMask }));
  }

  /** Map members to only the layers supplied by classified area relations, never routes. */
  private classifiedAreaMemberWayLayerMasks(bbox: GeoBbox2D): ReadonlyMap<number, number> {
    const masks = new Map<number, number>();
    for (const relationIndex of this.osm.relations.intersects(bbox)) {
      const relation = this.osm.relations.getByIndex(relationIndex);
      if (!relation.tags) continue;
      const matches = matchTags(relation.tags, "Polygon");
      if (matches.length === 0) continue;
      const geometry = this.osm.relations.getRelationGeometry(relationIndex);
      if (!geometry.rings || geometry.rings.length === 0) continue;
      let relationLayerMask = 0;
      for (const match of matches) {
        const bit = SHORTBREAD_LAYERS.findIndex((layer) => layer.name === match.layer.name);
        if (bit >= 0) relationLayerMask = (relationLayerMask | (1 << bit)) >>> 0;
      }
      for (const member of this.osm.relations.getMembersByIndex(relationIndex)) {
        if (member.type !== "way") continue;
        masks.set(member.ref, ((masks.get(member.ref) ?? 0) | relationLayerMask) >>> 0);
      }
    }
    return masks;
  }

  private layerMaskHasLayer(mask: number, layer: ShortbreadLayerName): boolean {
    return shortbreadFeatureHasLayer({ layerMask: mask }, layer);
  }

  private clipProjectedPolyline(points: XY[]): XY[][] {
    return clipPolyline(points, this.extentBbox);
  }

  private clipProjectedPolygon(points: XY[]): XY[][] {
    const clipped = clipPolygon(points, this.extentBbox);
    return [clipped];
  }

  private processClippedPolygonRing(rawRing: XY[], isOuter: boolean): XY[] {
    const snapped = rawRing.map((xy) => this.clampAndRoundPoint(xy));
    const cleaned = cleanRing(snapped);
    if (cleaned.length === 0) return [];

    const oriented = isOuter ? ensureClockwise(cleaned) : ensureCounterclockwise(cleaned);

    return oriented;
  }

  private clampAndRoundPoint(xy: XY): XY {
    const clampedX = Math.round(clamp(xy[0], this.extentBbox[0], this.extentBbox[2]));
    const clampedY = Math.round(clamp(xy[1], this.extentBbox[1], this.extentBbox[3]));
    return [clampedX, clampedY] as XY;
  }
}
