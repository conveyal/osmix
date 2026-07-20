import type { OsmPbfWay } from "@osmix/pbf";
import type { ContentHasher } from "@osmix/shared/content-hasher";
import type { GeoBbox2D, LonLat, OsmTags, OsmWay } from "@osmix/types";
import Flatbush from "flatbush";
import { around as geoAround } from "geoflatbush";

import { Entities, type EntitiesTransferables, isValidSpatialBbox } from "./entities.ts";
import { type IdOrIndex, Ids } from "./ids.ts";
import type { Nodes } from "./nodes.ts";
import type StringTable from "./stringtable.ts";
import { Tags } from "./tags.ts";
import { BufferConstructor, type BufferType, ResizeableTypedArray as RTA } from "./typed-arrays.ts";

const MISSING_NODE_INDEX = 0xffffffff;
const HASH_REF_CHUNK_SIZE = 8192;

export interface WaysTransferables<
  T extends BufferType = BufferType,
> extends EntitiesTransferables<T> {
  refStart: T;
  refCount: T;
  /** Node indexes, with `0xffffffff` marking an unresolved reference. */
  refs: T;
  /** Sorted positions in `refs` whose node ID could not be resolved. */
  missingRefPositions: T;
  /** OSM node IDs parallel to `missingRefPositions`. */
  missingRefIds: T;
  bbox: T;
  /** Optional - can be rebuilt via buildSpatialIndex() */
  spatialIndex?: T;
}

export class Ways extends Entities<OsmWay> {
  private spatialIndex: Flatbush = new Flatbush(1);
  // Track if spatial index was properly built (vs default empty)
  private spatialIndexBuilt = false;

  private refStart: RTA<Uint32Array>;
  private refCount: RTA<Uint16Array>; // Maximum 2,000 nodes per way

  // Node indexes. Missing node IDs are preserved in sparse parallel arrays.
  private refs: RTA<Uint32Array>;
  private missingRefPositions: RTA<Uint32Array>;
  private missingRefIds: RTA<Float64Array>;

  // Temporary OSM node IDs used when nodes are not indexed during ingestion.
  private pendingRefIds: RTA<Float64Array> | null;

  // Bounding box of the way in geographic coordinates
  private bbox: RTA<Float64Array>;

  // Node reference index
  private nodes: Nodes;

  private getNodeLonLat(refPosition: number): [number, number] {
    const coordinate = this.tryGetNodeLonLat(refPosition);
    if (!coordinate) {
      throw Error(`Node ${this.getMissingRefId(refPosition)} not found for way geometry`);
    }
    return coordinate;
  }

  /** Resolve a reference position to coordinates, or null when the node is absent. */
  private tryGetNodeLonLat(refPosition: number): [number, number] | null {
    const nodeIndex = this.refs.at(refPosition);
    if (nodeIndex !== MISSING_NODE_INDEX) {
      return this.nodes.getNodeLonLat({ index: nodeIndex });
    }
    // A missing ref may still resolve if the node was added after finalization.
    return this.nodes.getNodeLonLat({ id: this.getMissingRefId(refPosition) });
  }

  /**
   * Create a new Ways index.
   */
  constructor(stringTable: StringTable, nodes: Nodes, transferables?: WaysTransferables) {
    if (transferables) {
      super("way", new Ids(transferables), new Tags(stringTable, transferables));
      this.refStart = RTA.from(Uint32Array, transferables.refStart);
      this.refCount = RTA.from(Uint16Array, transferables.refCount);
      this.refs = RTA.from(Uint32Array, transferables.refs);
      this.missingRefPositions = RTA.from(Uint32Array, transferables.missingRefPositions);
      this.missingRefIds = RTA.from(Float64Array, transferables.missingRefIds);
      this.pendingRefIds = null;
      this.bbox = RTA.from(Float64Array, transferables.bbox);
      // Only load spatial index if provided (not stored in IndexedDB)
      if (transferables.spatialIndex?.byteLength) {
        this.spatialIndex = Flatbush.from(transferables.spatialIndex);
        this.spatialIndexBuilt = true;
      }
      this.indexBuilt = true;
    } else {
      super("way", new Ids(), new Tags(stringTable));
      this.refStart = new RTA(Uint32Array);
      this.refCount = new RTA(Uint16Array);
      this.refs = new RTA(Uint32Array);
      this.missingRefPositions = new RTA(Uint32Array);
      this.missingRefIds = new RTA(Float64Array);
      this.pendingRefIds = new RTA(Float64Array);
      this.bbox = new RTA(Float64Array);
    }
    this.nodes = nodes;
  }

  /**
   * Add a single way to the index.
   */
  addWay(way: OsmWay) {
    const wayIndex = this.addEntity(way.id, way.tags ?? {});
    this.refStart.push(this.refLength);
    this.refCount.push(way.refs.length);
    this.appendRefIds(way.refs);
    return wayIndex;
  }

  /**
   * Bulk add ways directly from a PBF PrimitiveBlock.
   */
  addWays(
    ways: OsmPbfWay[],
    blockStringIndexMap: Uint32Array,
    filter?: (way: OsmWay) => OsmWay | null,
    nodeIdToIndex?: (nodeId: number) => number,
  ) {
    let added = 0;
    for (const way of ways) {
      let prevRefId = 0;
      const refs = way.refs.map((refId) => {
        prevRefId += refId;
        return prevRefId;
      });
      const tagKeys: number[] = way.keys.map((key) => {
        const index = blockStringIndexMap[key];
        if (index === undefined) throw Error("Tag key not found");
        return index;
      });
      const tagValues: number[] = way.vals.map((val) => {
        const index = blockStringIndexMap[val];
        if (index === undefined) throw Error("Tag value not found");
        return index;
      });
      const filteredWay = filter
        ? filter({
            id: way.id,
            refs,
            tags: this.tags.getTagsFromIndices(tagKeys, tagValues),
          })
        : null;
      if (filter && filteredWay === null) continue;

      this.addEntity(way.id, tagKeys, tagValues);
      const addedRefs = filteredWay?.refs ?? refs;
      this.refStart.push(this.refLength);
      this.refCount.push(addedRefs.length);
      this.appendRefIds(addedRefs, nodeIdToIndex);
      added++;
    }
    return added;
  }

  /**
   * Compact the internal arrays to free up memory.
   *
   * Must run after the node ID index is built (`Osm.buildIndexes()` orders
   * nodes before ways) so pending OSM node IDs resolve to compact `Uint32`
   * node indexes. If the node index is not ready, every pending ref degrades
   * to the larger missing-ref representation (sentinel + sorted ID lookup).
   */
  buildEntityIndex() {
    this.refStart.compact();
    this.refCount.compact();
    if (this.pendingRefIds && this.pendingRefIds.length > 0) {
      if (this.refs.length > 0) throw Error("Mixed pending and indexed way references.");
      const refsBuffer = new BufferConstructor(
        this.pendingRefIds.length * Uint32Array.BYTES_PER_ELEMENT,
      );
      this.refs = RTA.from(Uint32Array, refsBuffer);
      const canResolveNodes = this.nodes.ids.isReady();
      if (!canResolveNodes) {
        console.warn(
          "Ways.buildEntityIndex ran before the node index was ready; all way references will use the missing-ref representation.",
        );
      }
      for (let i = 0; i < this.pendingRefIds.length; i++) {
        const refId = this.pendingRefIds.at(i);
        const nodeIndex = canResolveNodes ? this.nodes.ids.getIndexFromId(refId) : -1;
        this.setIndexedRef(i, refId, nodeIndex);
      }
    }
    this.pendingRefIds = null;
    this.refs.compact();
    this.missingRefPositions.compact();
    this.missingRefIds.compact();
  }

  /**
   * Build the spatial index for ways.
   * If bbox data already exists (e.g., loaded from storage), reuses it.
   */
  buildSpatialIndex() {
    if (!this.nodes.isReady()) throw Error("Node index is not ready.");
    if (this.size === 0) {
      this.spatialIndex = new Flatbush(1, 128, Float64Array, BufferConstructor);
      this.spatialIndexBuilt = true;
      return this.spatialIndex;
    }

    this.spatialIndex = new Flatbush(this.size, 128, Float64Array, BufferConstructor);

    // If bbox already has data (loaded from storage), use it directly
    const hasBboxData = this.bbox.length >= this.size * 4;
    for (let i = 0; i < this.size; i++) {
      let minX: number;
      let minY: number;
      let maxX: number;
      let maxY: number;

      if (hasBboxData) {
        // Use stored bbox values
        minX = this.bbox.at(i * 4);
        minY = this.bbox.at(i * 4 + 1);
        maxX = this.bbox.at(i * 4 + 2);
        maxY = this.bbox.at(i * 4 + 3);
      } else {
        // Calculate bbox from resolvable node coordinates. Missing refs are
        // preserved losslessly in storage but contribute no geometry; a way
        // with no resolvable refs keeps an inverted bbox that never matches.
        minX = Number.POSITIVE_INFINITY;
        minY = Number.POSITIVE_INFINITY;
        maxX = Number.NEGATIVE_INFINITY;
        maxY = Number.NEGATIVE_INFINITY;
        const start = this.refStart.at(i);
        const count = this.refCount.at(i);
        for (let j = start; j < start + count; j++) {
          const coordinate = this.tryGetNodeLonLat(j);
          if (!coordinate) continue;
          const [lon, lat] = coordinate;
          if (lon < minX) minX = lon;
          if (lon > maxX) maxX = lon;
          if (lat < minY) minY = lat;
          if (lat > maxY) maxY = lat;
        }
        this.bbox.push(minX);
        this.bbox.push(minY);
        this.bbox.push(maxX);
        this.bbox.push(maxY);
      }
      this.spatialIndex.add(minX, minY, maxX, maxY);
    }
    // Compact bbox if we just calculated it
    if (!hasBboxData) {
      this.bbox.compact();
    }
    this.spatialIndex.finish();
    this.spatialIndexBuilt = true;
    return this.spatialIndex;
  }

  /**
   * Check if the spatial index has been built.
   */
  hasSpatialIndex(): boolean {
    return this.spatialIndexBuilt;
  }

  /**
   * Get the full way entity.
   */
  getFullEntity(index: number, id: number, tags?: OsmTags): OsmWay {
    return {
      id,
      refs: [...this.getRefIds(index)],
      tags,
    };
  }

  /**
   * Get the node IDs referenced by a way.
   */
  getRefIds(index: number): number[] {
    const start = this.refStart.at(index);
    const count = this.refCount.at(index);
    const refs = Array.from<number>({ length: count });
    for (let i = 0; i < count; i++) refs[i] = this.getRefId(start + i);
    return refs;
  }

  /**
   * Get the bounding box of a way.
   */
  getEntityBbox(idOrIndex: IdOrIndex): GeoBbox2D {
    const index = "index" in idOrIndex ? idOrIndex.index : this.ids.idOrIndex(idOrIndex)[0];
    return [
      this.bbox.at(index * 4),
      this.bbox.at(index * 4 + 1),
      this.bbox.at(index * 4 + 2),
      this.bbox.at(index * 4 + 3),
    ];
  }

  /**
   * Get the coordinates of a way as a flat array.
   */
  getLine(index: number) {
    const count = this.refCount.at(index);
    const start = this.refStart.at(index);
    const line = new Float64Array(count * 2);
    for (let i = 0; i < count; i++) {
      const [lon, lat] = this.getNodeLonLat(start + i);
      line[i * 2] = lon;
      line[i * 2 + 1] = lat;
    }
    return line;
  }

  /**
   * Get the coordinates of a way as an array of [lon, lat] pairs.
   * Throws when a referenced node cannot be resolved; use
   * `getResolvedCoordinates()` for tolerant consumers such as bbox building.
   */
  getCoordinates(index: number): LonLat[] {
    const count = this.refCount.at(index);
    const start = this.refStart.at(index);
    const coords: [number, number][] = [];
    for (let refIndex = start; refIndex < start + count; refIndex++) {
      coords.push(this.getNodeLonLat(refIndex));
    }
    return coords;
  }

  /**
   * Get the resolvable coordinates of a way, skipping missing node refs.
   * Preferred over `getCoordinates()` when partial geometry is acceptable,
   * e.g. computing bounding boxes over referentially incomplete extracts.
   */
  getResolvedCoordinates(index: number): LonLat[] {
    const count = this.refCount.at(index);
    const start = this.refStart.at(index);
    const coords: [number, number][] = [];
    for (let refIndex = start; refIndex < start + count; refIndex++) {
      const coordinate = this.tryGetNodeLonLat(refIndex);
      if (coordinate) coords.push(coordinate);
    }
    return coords;
  }

  /**
   * Find way indexes that intersect a bounding box.
   */
  intersects(bbox: GeoBbox2D, filterFn?: (index: number) => boolean): number[] {
    if (this.size === 0) return [];
    // A way with no resolvable refs stores an inverted bbox. Flatbush's
    // contained-node fast path skips per-leaf intersection tests, so filter
    // inverted boxes out explicitly.
    return this.spatialIndex.search(bbox[0], bbox[1], bbox[2], bbox[3], (index, x0, y0, x1, y1) => {
      if (!isValidSpatialBbox(x0, y0, x1, y1)) return false;
      return filterFn ? filterFn(index) : true;
    });
  }

  /**
   * Find way indexes near a point using great-circle distance.
   * @param lon - Longitude in degrees.
   * @param lat - Latitude in degrees.
   * @param maxResults - Maximum number of results to return.
   * @param maxDistanceKm - Maximum distance in kilometers.
   * @returns Array of way indexes sorted by distance.
   */
  neighbors(lon: number, lat: number, maxResults?: number, maxDistanceKm?: number): number[] {
    if (this.size === 0) return [];
    // Use geoflatbush for proper geographic distance calculations
    return geoAround(this.spatialIndex, lon, lat, maxResults, maxDistanceKm, (index) => {
      const offset = index * 4;
      return isValidSpatialBbox(
        this.bbox.at(offset),
        this.bbox.at(offset + 1),
        this.bbox.at(offset + 2),
        this.bbox.at(offset + 3),
      );
    });
  }

  /**
   * Get ways within a bounding box.
   */
  withinBbox(
    bbox: GeoBbox2D,
    include?: (index: number) => boolean,
  ): {
    ids: Float64Array;
    positions: Float64Array;
    startIndices: Uint32Array;
  } {
    const wayCandidates = this.intersects(bbox, include);
    const ids = new Float64Array(wayCandidates.length);
    const wayPositions: Float64Array[] = [];
    const wayStartIndices = new Uint32Array(wayCandidates.length + 1);
    wayStartIndices[0] = 0;

    let size = 0;
    wayCandidates.forEach((wayIndex, i) => {
      ids[i] = this.ids.at(wayIndex);
      const way = this.getLine(wayIndex);
      size += way.length;
      wayPositions.push(way);
      const prevIndex = wayStartIndices[i];
      if (prevIndex === undefined) throw Error("Previous index is undefined");
      wayStartIndices[i + 1] = prevIndex + way.length / 2;
    });
    const wayPositionsArray = new Float64Array(size);
    let pIndex = 0;
    for (const way of wayPositions) {
      wayPositionsArray.set(way, pIndex);
      pIndex += way.length;
    }

    return {
      ids,
      positions: wayPositionsArray,
      startIndices: wayStartIndices,
    };
  }

  /**
   * Get transferable objects for passing to another thread.
   * Only includes spatialIndex if it has been built.
   */
  override transferables(): WaysTransferables {
    const base = {
      ...super.transferables(),
      refStart: this.refStart.array.buffer,
      refCount: this.refCount.array.buffer,
      refs: this.refs.array.buffer,
      missingRefPositions: this.missingRefPositions.array.buffer,
      missingRefIds: this.missingRefIds.array.buffer,
      bbox: this.bbox.array.buffer,
    };
    // Only include spatial index if it was built
    if (this.spatialIndexBuilt) {
      return { ...base, spatialIndex: this.spatialIndex.data };
    }
    return base;
  }

  /**
   * Get the approximate memory requirements for a given number of ways in bytes.
   */
  static getBytesRequired(count: number, refCount = 0, missingRefCount = 0) {
    if (count === 0) return 0;
    // Approximate nodes per way
    let numNodes = count;
    let n = count;
    while (n !== 1) {
      n = Math.ceil(n / 128);
      numNodes += n;
    }
    const indexBytes = (numNodes < 16384 ? 2 : 4) * numNodes;
    const boxesBytes = numNodes * 4 * Float64Array.BYTES_PER_ELEMENT;
    const spatialIndexBytes = 8 + indexBytes + boxesBytes;

    return (
      Ids.getBytesRequired(count) +
      Tags.getBytesRequired(count) +
      count * Uint32Array.BYTES_PER_ELEMENT + // refStart
      count * Uint16Array.BYTES_PER_ELEMENT + // refCount
      refCount * Uint32Array.BYTES_PER_ELEMENT + // node indexes
      missingRefCount * (Uint32Array.BYTES_PER_ELEMENT + Float64Array.BYTES_PER_ELEMENT) + // missing refs
      count * 4 * Float64Array.BYTES_PER_ELEMENT + // bbox
      spatialIndexBytes
    );
  }

  /**
   * Update a ContentHasher with way-specific data (node references).
   */
  override updateHash(hasher: ContentHasher): ContentHasher {
    super.updateHash(hasher).update(this.refCount.array);
    const chunk = new Float64Array(Math.min(HASH_REF_CHUNK_SIZE, this.refs.length));
    let chunkLength = 0;
    for (let i = 0; i < this.refs.length; i++) {
      chunk[chunkLength++] = this.getRefId(i);
      if (chunkLength === chunk.length) {
        hasher.update(chunk);
        chunkLength = 0;
      }
    }
    if (chunkLength > 0) hasher.update(chunk.subarray(0, chunkLength));
    return hasher;
  }

  /** Logical reference length during either pending-ID or indexed ingestion. */
  private get refLength(): number {
    return this.pendingRefIds?.length ?? this.refs.length;
  }

  /** Append OSM node IDs, optionally resolving them directly to node indexes. */
  private appendRefIds(refIds: number[], nodeIdToIndex?: (nodeId: number) => number) {
    if (nodeIdToIndex) {
      if ((this.pendingRefIds?.length ?? 0) > 0) {
        throw Error("Cannot mix unresolved and directly indexed way references.");
      }
      this.pendingRefIds = null;
      for (const refId of refIds) {
        this.setIndexedRef(this.refs.length, refId, nodeIdToIndex(refId));
      }
      return;
    }
    if (!this.pendingRefIds) {
      throw Error("Directly indexed way references require a node ID resolver.");
    }
    this.pendingRefIds.pushMany(refIds);
  }

  /** Store one resolved or losslessly preserved missing reference. */
  private setIndexedRef(position: number, refId: number, nodeIndex: number) {
    if (nodeIndex < 0) {
      this.refs.set(position, MISSING_NODE_INDEX);
      this.missingRefPositions.push(position);
      this.missingRefIds.push(refId);
      return;
    }
    if (!Number.isInteger(nodeIndex) || nodeIndex >= MISSING_NODE_INDEX) {
      throw Error(`Invalid node index ${nodeIndex} for reference ${refId}`);
    }
    this.refs.set(position, nodeIndex);
  }

  /** Reconstruct the public OSM node ID for one internal reference position. */
  private getRefId(position: number): number {
    const nodeIndex = this.refs.at(position);
    return nodeIndex === MISSING_NODE_INDEX
      ? this.getMissingRefId(position)
      : this.nodes.ids.at(nodeIndex);
  }

  /** Find the OSM node ID for a sentinel reference position. */
  private getMissingRefId(position: number): number {
    let low = 0;
    let high = this.missingRefPositions.length - 1;
    while (low <= high) {
      const middle = (low + high) >>> 1;
      const candidate = this.missingRefPositions.at(middle);
      if (candidate === position) return this.missingRefIds.at(middle);
      if (candidate < position) low = middle + 1;
      else high = middle - 1;
    }
    throw Error(`Missing node ID not found for way reference position ${position}`);
  }
}
