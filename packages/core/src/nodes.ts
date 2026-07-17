import { microToDegrees, OSM_COORD_SCALE, toMicroDegrees } from "@osmix/geo/coordinates";
import type { OsmPbfBlock, OsmPbfDenseNodes } from "@osmix/pbf";
import { assertValue } from "@osmix/shared/assert";
import type { ContentHasher } from "@osmix/shared/content-hasher";
import type { GeoBbox2D, OsmNode, OsmTags } from "@osmix/types";

import { Entities, type EntitiesTransferables } from "./entities.ts";
import { type IdOrIndex, Ids } from "./ids.ts";
import { IndirectKdIndex } from "./indirect-kd-index.ts";
import type StringTable from "./stringtable.ts";
import { Tags } from "./tags.ts";
import { type BufferType, ResizeableTypedArray as RTA } from "./typed-arrays.ts";

const EARTH_RADIUS_KM = 6371.0088;
const COORDINATE_PADDING_DEGREES = 1 / OSM_COORD_SCALE;

export type NodeSpatialIndexKind = "all" | "tagged";

export class SpatialIndexNotBuiltError extends Error {
  readonly code = "SPATIAL_INDEX_NOT_BUILT";
  readonly entityType = "node";
  readonly indexKind: NodeSpatialIndexKind;

  constructor(indexKind: NodeSpatialIndexKind) {
    super(`The ${indexKind} node spatial index has not been built.`);
    this.name = "SpatialIndexNotBuiltError";
    this.indexKind = indexKind;
  }
}

export interface NodesTransferables<
  T extends BufferType = BufferType,
> extends EntitiesTransferables<T> {
  lons: T;
  lats: T;
  bbox: GeoBbox2D;
  /** Optional all-node Uint32 permutation; can be rebuilt via buildSpatialIndex("all"). */
  allSpatialIndex?: T;
  /** Optional tagged-node Uint32 permutation; can be rebuilt via buildSpatialIndex("tagged"). */
  taggedSpatialIndex?: T;
}

export interface AddNodeOptions {
  filter?: (node: OsmNode) => boolean;
}

export class Nodes extends Entities<OsmNode> {
  /**
   * Coordinates are stored as integer microdegrees (Int32Array).
   * Use OSM_COORD_SCALE (1e7) to convert between degrees and microdegrees.
   */
  private lons: RTA<Int32Array>;
  private lats: RTA<Int32Array>;
  // Bounding box is exposed and transferred in degrees.
  private bbox: [minLon: number, minLat: number, maxLon: number, maxLat: number] = [
    Number.MAX_SAFE_INTEGER,
    Number.MAX_SAFE_INTEGER,
    Number.MIN_SAFE_INTEGER,
    Number.MIN_SAFE_INTEGER,
  ];
  private allSpatialIndex?: IndirectKdIndex;
  private taggedSpatialIndex?: IndirectKdIndex;

  /**
   * Create a new Nodes index.
   */
  constructor(stringTable: StringTable, transferables?: NodesTransferables) {
    if (transferables) {
      super("node", new Ids(transferables), new Tags(stringTable, transferables));
      this.lons = RTA.from(Int32Array, transferables.lons);
      this.lats = RTA.from(Int32Array, transferables.lats);
      if (transferables.allSpatialIndex !== undefined) {
        this.allSpatialIndex = IndirectKdIndex.from(
          this.lons.array,
          this.lats.array,
          transferables.allSpatialIndex,
        );
      }
      if (transferables.taggedSpatialIndex !== undefined) {
        this.taggedSpatialIndex = IndirectKdIndex.from(
          this.lons.array,
          this.lats.array,
          transferables.taggedSpatialIndex,
        );
      }
      this.bbox = transferables.bbox;
      this.indexBuilt = true;
    } else {
      super("node", new Ids(), new Tags(stringTable));
      this.lons = new RTA(Int32Array);
      this.lats = new RTA(Int32Array);
    }
  }

  /**
   * Add a single node to the index.
   */
  addNode(node: OsmNode): number {
    const nodeIndex = this.addEntity(node.id, node.tags ?? {});

    const lonMicro = toMicroDegrees(node.lon);
    const latMicro = toMicroDegrees(node.lat);

    this.lons.push(lonMicro);
    this.lats.push(latMicro);

    if (node.lon < this.bbox[0]) this.bbox[0] = node.lon;
    if (node.lat < this.bbox[1]) this.bbox[1] = node.lat;
    if (node.lon > this.bbox[2]) this.bbox[2] = node.lon;
    if (node.lat > this.bbox[3]) this.bbox[3] = node.lat;

    return nodeIndex;
  }

  /**
   * Add dense nodes from a PBF block.
   */
  addDenseNodes(
    dense: OsmPbfDenseNodes,
    block: OsmPbfBlock,
    blockStringIndexMap: Uint32Array,
    filter?: (node: OsmNode) => boolean,
  ): number {
    // PBF block already has offsets and granularity converted to degrees
    const lon_offset = block.lon_offset ?? 0;
    const lat_offset = block.lat_offset ?? 0;
    const granularity = block.granularity ?? 1e7;

    const delta = {
      id: 0,
      lat: 0,
      lon: 0,
      timestamp: 0,
      changeset: 0,
      uid: 0,
      user_sid: 0,
    };

    const getStringTableIndex = (keyIndex: number) => {
      const key = dense.keys_vals[keyIndex];
      assertValue(key, "Block string key is undefined");
      const index = blockStringIndexMap[key];
      assertValue(index, "Block string not found");
      return index;
    };

    let keysValsIndex = 0;
    let added = 0;
    for (let i = 0; i < dense.id.length; i++) {
      const idSid = dense.id[i];
      const latSid = dense.lat[i];
      const lonSid = dense.lon[i];
      assertValue(idSid, "ID SID is undefined");
      assertValue(latSid, "Latitude SID is undefined");
      assertValue(lonSid, "Longitude SID is undefined");

      delta.id += idSid;
      delta.lat += latSid;
      delta.lon += lonSid;

      // Calculate degrees from PBF delta encoding
      const lon = lon_offset + delta.lon / granularity;
      const lat = lat_offset + delta.lat / granularity;

      // Convert to microdegrees for storage
      const lonMicro = toMicroDegrees(lon);
      const latMicro = toMicroDegrees(lat);

      const tagKeys: number[] = [];
      const tagValues: number[] = [];
      if (dense.keys_vals.length > 0) {
        while (dense.keys_vals[keysValsIndex] !== 0) {
          const key = getStringTableIndex(keysValsIndex);
          const val = getStringTableIndex(keysValsIndex + 1);
          if (key && val) {
            tagKeys.push(key);
            tagValues.push(val);
          }
          keysValsIndex += 2;
        }
        keysValsIndex++;
      }

      const shouldInclude = filter
        ? filter({
            id: delta.id,
            lon,
            lat,
            tags: this.tags.getTagsFromIndices(tagKeys, tagValues),
          })
        : true;
      if (!shouldInclude) continue;

      this.addEntity(delta.id, tagKeys, tagValues);
      this.lons.push(lonMicro);
      this.lats.push(latMicro);

      if (lon < this.bbox[0]) this.bbox[0] = lon;
      if (lat < this.bbox[1]) this.bbox[1] = lat;
      if (lon > this.bbox[2]) this.bbox[2] = lon;
      if (lat > this.bbox[3]) this.bbox[3] = lat;
      added++;
    }

    return added;
  }

  /**
   * Compact the internal arrays to free up memory.
   */
  buildEntityIndex() {
    this.lons.compact();
    this.lats.compact();
  }

  /**
   * Build one of the independent node spatial indexes.
   */
  buildSpatialIndex(kind: NodeSpatialIndexKind = "all") {
    if (this.hasSpatialIndex(kind)) return;

    console.time(`NodeIndex.buildSpatialIndex.${kind}`);
    if (kind === "all") {
      this.allSpatialIndex = IndirectKdIndex.build(
        this.lons.array,
        this.lats.array,
        this.size,
        (indexes) => {
          for (let i = 0; i < indexes.length; i++) indexes[i] = i;
        },
      );
    } else {
      this.taggedSpatialIndex = IndirectKdIndex.build(
        this.lons.array,
        this.lats.array,
        this.taggedSize,
        (indexes) => {
          let position = 0;
          for (const entityIndex of this.tags.taggedEntityIndexes()) {
            indexes[position++] = entityIndex;
          }
          if (position !== indexes.length) {
            throw new Error(
              `Expected ${indexes.length} tagged nodes while building index, received ${position}`,
            );
          }
        },
      );
    }
    console.timeEnd(`NodeIndex.buildSpatialIndex.${kind}`);
  }

  /**
   * Check if the spatial index has been built.
   */
  hasSpatialIndex(kind: NodeSpatialIndexKind = "all"): boolean {
    return kind === "all"
      ? this.allSpatialIndex !== undefined
      : this.taggedSpatialIndex !== undefined;
  }

  /** Number of nodes that carry at least one tag. */
  get taggedSize(): number {
    return this.tags.taggedEntityCount;
  }

  /**
   * Get the bounding box of all nodes.
   */
  getBbox(): GeoBbox2D {
    return this.bbox;
  }

  /**
   * Get the bounding box of a specific node.
   */
  getEntityBbox(i: IdOrIndex): GeoBbox2D {
    const index = "index" in i ? i.index : this.ids.idOrIndex(i)[0];
    const lon = microToDegrees(this.lons.at(index));
    const lat = microToDegrees(this.lats.at(index));
    return [lon, lat, lon, lat] as GeoBbox2D;
  }

  /**
   * Get the longitude and latitude of a specific node.
   * ID lookups return `null` when the node is not present; index lookups remain strict.
   */
  getNodeLonLat(i: { index: number }): [number, number];
  getNodeLonLat(i: { id: number }): [number, number] | null;
  getNodeLonLat(i: IdOrIndex): [number, number] | null {
    const index = "index" in i ? i.index : this.ids.idOrIndex(i)[0];
    if (index === -1) return null;
    return [microToDegrees(this.lons.at(index)), microToDegrees(this.lats.at(index))];
  }

  /**
   * Get the full node entity.
   */
  getFullEntity(index: number, id: number, tags?: OsmTags): OsmNode {
    const [lon, lat] = this.getNodeLonLat({ index });
    if (tags) {
      return {
        id,
        lat,
        lon,
        tags,
      };
    }
    return {
      id,
      lat,
      lon,
    };
  }

  // Spatial operations
  /**
   * Find node indexes within a bounding box.
   */
  findIndexesWithinBbox(bbox: GeoBbox2D): number[] {
    return findIndexesWithinBbox(this.getSpatialIndex("all"), bbox);
  }

  /** Find tagged node indexes within a bounding box. */
  findTaggedIndexesWithinBbox(bbox: GeoBbox2D): number[] {
    return findIndexesWithinBbox(this.getSpatialIndex("tagged"), bbox);
  }

  /**
   * Find node indexes within a radius of a point.
   * Uses an exact haversine-distance filter over a conservative KD bbox query.
   * @param lon - Longitude in degrees.
   * @param lat - Latitude in degrees.
   * @param radiusKm - Radius in kilometers.
   * @returns Array of node indexes within the radius.
   */
  findIndexesWithinRadius(lon: number, lat: number, radiusKm: number): number[] {
    const spatialIndex = this.getSpatialIndex("all");
    if (!Number.isFinite(lon) || !Number.isFinite(lat)) {
      throw new RangeError("Longitude and latitude must be finite numbers");
    }
    if (lat < -90 || lat > 90) throw new RangeError("Latitude must be between -90 and 90");
    if (Number.isNaN(radiusKm) || radiusKm < 0) return [];

    const normalizedLon = normalizeLongitude(lon);
    const bbox = radiusBoundingBox(normalizedLon, lat, radiusKm);
    const candidates = findIndexesWithinBbox(spatialIndex, bbox);
    const matches: { distance: number; index: number }[] = [];
    for (const index of candidates) {
      const nodeLon = microToDegrees(this.lons.at(index));
      const nodeLat = microToDegrees(this.lats.at(index));
      const distance = haversineDistanceKm(normalizedLon, lat, nodeLon, nodeLat);
      if (distance <= radiusKm) matches.push({ distance, index });
    }
    matches.sort((a, b) => a.distance - b.distance || a.index - b.index);
    return matches.map(({ index }) => index);
  }

  /**
   * Get nodes within a bounding box.
   * @param bbox - The bounding box to search within.
   * @param include - A function to filter nodes. If provided, only nodes for which the function returns true will be included.
   * @returns An object containing the IDs and positions of the nodes within the bounding box.
   */
  withinBbox(
    bbox: GeoBbox2D,
    include?: (i: number) => boolean,
  ): {
    ids: Float64Array;
    positions: Float64Array;
  } {
    console.time("Nodes.withinBbox");
    const nodeCandidates = this.findIndexesWithinBbox(bbox);
    const nodePositions = new Float64Array(nodeCandidates.length * 2);
    const ids = new Float64Array(nodeCandidates.length);

    let skipped = 0;
    nodeCandidates.forEach((nodeIndex, i) => {
      if (include && !include(nodeIndex)) {
        skipped++;
        return;
      }

      const [lon, lat] = this.getNodeLonLat({ index: nodeIndex });
      ids[i - skipped] = this.ids.at(nodeIndex);
      nodePositions[(i - skipped) * 2] = lon;
      nodePositions[(i - skipped) * 2 + 1] = lat;
    });
    console.timeEnd("Nodes.withinBbox");
    return {
      ids: ids.subarray(0, nodeCandidates.length - skipped),
      positions: nodePositions.slice(0, (nodeCandidates.length - skipped) * 2),
    };
  }

  /**
   * Get transferable objects for passing to another thread.
   * Only includes spatial indexes that have been built.
   */
  override transferables(): NodesTransferables {
    const base = {
      ...super.transferables(),
      lons: this.lons.array.buffer,
      lats: this.lats.array.buffer,
      bbox: this.bbox,
    };
    return {
      ...base,
      ...(this.allSpatialIndex ? { allSpatialIndex: this.allSpatialIndex.buffer } : {}),
      ...(this.taggedSpatialIndex ? { taggedSpatialIndex: this.taggedSpatialIndex.buffer } : {}),
    };
  }

  /**
   * Get the approximate memory requirements for a given number of nodes in bytes.
   */
  static getBytesRequired(count: number, taggedCount = count) {
    if (count === 0) return 0;

    return (
      Ids.getBytesRequired(count) +
      Tags.getBytesRequired(count, taggedCount) +
      count * Int32Array.BYTES_PER_ELEMENT + // lons (stored in microdegrees)
      count * Int32Array.BYTES_PER_ELEMENT + // lats (stored in microdegrees)
      Nodes.getSpatialIndexBytesRequired(count) +
      Nodes.getSpatialIndexBytesRequired(taggedCount)
    );
  }

  /** Exact bytes in an indirect node spatial-index permutation. */
  static getSpatialIndexBytesRequired(count: number): number {
    return count * Uint32Array.BYTES_PER_ELEMENT;
  }

  /**
   * Update a ContentHasher with node-specific data (coordinates).
   */
  override updateHash(hasher: ContentHasher): ContentHasher {
    return super.updateHash(hasher).update(this.lons.array).update(this.lats.array);
  }

  private getSpatialIndex(kind: NodeSpatialIndexKind): IndirectKdIndex {
    const index = kind === "all" ? this.allSpatialIndex : this.taggedSpatialIndex;
    if (!index) throw new SpatialIndexNotBuiltError(kind);
    return index;
  }
}

function findIndexesWithinBbox(index: IndirectKdIndex, bbox: GeoBbox2D): number[] {
  const [minLon, minLat, maxLon, maxLat] = bbox;
  if (minLat > maxLat) return [];

  const microMinLat = Math.ceil(minLat * OSM_COORD_SCALE);
  const microMaxLat = Math.floor(maxLat * OSM_COORD_SCALE);
  if (microMinLat > microMaxLat) return [];

  let result: number[];
  if (minLon <= maxLon) {
    result = index.range(
      Math.ceil(minLon * OSM_COORD_SCALE),
      microMinLat,
      Math.floor(maxLon * OSM_COORD_SCALE),
      microMaxLat,
    );
  } else {
    result = index
      .range(Math.ceil(minLon * OSM_COORD_SCALE), microMinLat, 180 * OSM_COORD_SCALE, microMaxLat)
      .concat(
        index.range(
          -180 * OSM_COORD_SCALE,
          microMinLat,
          Math.floor(maxLon * OSM_COORD_SCALE),
          microMaxLat,
        ),
      );
  }
  return result;
}

function radiusBoundingBox(lon: number, lat: number, radiusKm: number): GeoBbox2D {
  if (!Number.isFinite(radiusKm)) return [-180, -90, 180, 90];
  const angularRadius = radiusKm / EARTH_RADIUS_KM;
  if (angularRadius >= Math.PI) return [-180, -90, 180, 90];

  const latRadians = degreesToRadians(lat);
  const minLatRadians = Math.max(-Math.PI / 2, latRadians - angularRadius);
  const maxLatRadians = Math.min(Math.PI / 2, latRadians + angularRadius);
  const minLat = Math.max(-90, radiansToDegrees(minLatRadians) - COORDINATE_PADDING_DEGREES);
  const maxLat = Math.min(90, radiansToDegrees(maxLatRadians) + COORDINATE_PADDING_DEGREES);

  if (
    angularRadius >= Math.PI / 2 ||
    minLatRadians <= -Math.PI / 2 ||
    maxLatRadians >= Math.PI / 2
  ) {
    return [-180, minLat, 180, maxLat];
  }

  const ratio = Math.sin(angularRadius) / Math.cos(latRadians);
  const deltaLon =
    radiansToDegrees(Math.asin(Math.min(1, Math.max(-1, ratio)))) + COORDINATE_PADDING_DEGREES;
  const rawMinLon = lon - deltaLon;
  const rawMaxLon = lon + deltaLon;
  return [normalizeLongitude(rawMinLon), minLat, normalizeLongitude(rawMaxLon), maxLat];
}

function haversineDistanceKm(lon1: number, lat1: number, lon2: number, lat2: number): number {
  const latDelta = degreesToRadians(lat2 - lat1);
  const lonDelta = degreesToRadians(lon2 - lon1);
  const lat1Radians = degreesToRadians(lat1);
  const lat2Radians = degreesToRadians(lat2);
  const a =
    Math.sin(latDelta / 2) ** 2 +
    Math.sin(lonDelta / 2) ** 2 * Math.cos(lat1Radians) * Math.cos(lat2Radians);
  return 2 * EARTH_RADIUS_KM * Math.atan2(Math.sqrt(a), Math.sqrt(Math.max(0, 1 - a)));
}

function normalizeLongitude(lon: number): number {
  if (lon >= -180 && lon <= 180) return lon;
  const normalized = ((((lon + 180) % 360) + 360) % 360) - 180;
  return normalized === -180 && lon > 0 ? 180 : normalized;
}

function degreesToRadians(value: number): number {
  return value * (Math.PI / 180);
}

function radiansToDegrees(value: number): number {
  return value * (180 / Math.PI);
}
