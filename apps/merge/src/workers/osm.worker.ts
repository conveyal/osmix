/**
 * Extended OsmixWorker with IndexedDB storage capabilities.
 *
 * Handles file hashing, storage, and retrieval in the worker thread
 * to keep the main UI responsive. Uses BroadcastChannel to notify
 * the main thread of storage changes.
 */

import { expose } from "comlink";
import { createSHA256 } from "hash-wasm";
import { type DBSchema, type IDBPDatabase, openDB } from "idb";
import type {
  BufferType,
  OsmFromPbfOptions,
  OsmInfo,
  OsmLoadDecision,
  OsmTransferables,
} from "osmix";
import {
  buildOsmSpatialIndexesForProfile,
  buildSelectedOsmSpatialIndexes,
  canShareArrayBuffers,
  getOsmStorableBufferBytes,
  Osm,
} from "osmix";
import { OsmixWorker } from "osmix";

import { DB_NAME, DB_VERSION, OSM_STORE, STORAGE_CHANNEL } from "../settings";
import { hashStreamIncrementally } from "./incremental-hash";
import { type OsmSchemaUpgradeDatabase, upgradeOsmStore } from "./storage-schema";

/** File metadata stored alongside Osm data */
export interface StoredFileInfo {
  fileHash: string;
  fileName: string;
  fileSize: number;
  sourceUrl?: string;
}

export interface StoredOsmEntry extends StoredFileInfo {
  info: OsmInfo;
  storedAt: number;
  lastAccessedAt: number;
  loadDecision: OsmLoadDecision | null;
  storedBytes: number;
}

export interface StoredOsm extends StoredOsmEntry, OsmTransferables<ArrayBuffer> {}

export interface PbfUrlLoadResult {
  info: OsmInfo;
  fileInfo: StoredFileInfo;
  existing: StoredOsmEntry | null;
}

export interface OsmixDB extends DBSchema {
  [OSM_STORE]: {
    key: string;
    value: StoredOsm;
    indexes: {
      "by-stored-at": number;
      "by-hash": string;
      "by-last-accessed": number;
    };
  };
}

function pbfFileName(response: Response, inputUrl: string): string {
  const disposition = response.headers.get("content-disposition");
  const dispositionMatch = disposition?.match(/filename\*?=(?:UTF-8''|["'])?([^"';]+)/i);
  let name = dispositionMatch?.[1];
  if (name) {
    try {
      name = decodeURIComponent(name);
    } catch {
      // Keep the server-provided spelling when it is not URI encoded.
    }
  }
  if (!name) {
    const segment = new URL(inputUrl).pathname.split("/").filter(Boolean).at(-1);
    name = segment ? decodeURIComponent(segment) : "download.osm.pbf";
  }
  if (!name.toLowerCase().endsWith(".pbf")) {
    throw new Error(`URL must resolve to an OSM PBF file (got "${name}").`);
  }
  return name;
}

/**
 * Extended worker with IndexedDB storage capabilities.
 * All heavy operations (hashing, storage, loading) run off the main thread.
 */
export class MergeWorker extends OsmixWorker {
  private dbPromise: Promise<IDBPDatabase<OsmixDB>> | null = null;
  private broadcastChannel = new BroadcastChannel(STORAGE_CHANNEL);
  private hashControllers = new Map<string, AbortController>();

  constructor() {
    super();
    this.broadcastChannel.addEventListener("message", (event) => {
      if (event.data.type === "delete") {
        this.delete(event.data.id);
      }
    });
  }

  private async getDB(): Promise<IDBPDatabase<OsmixDB>> {
    if (!this.dbPromise) {
      this.dbPromise = openDB<OsmixDB>(DB_NAME, DB_VERSION, {
        upgrade(db, oldVersion) {
          upgradeOsmStore(db as unknown as OsmSchemaUpgradeDatabase, oldVersion);
        },
      });
    }
    return this.dbPromise;
  }

  /** Notify main thread of storage changes via BroadcastChannel */
  private notifyStorageChange() {
    this.broadcastChannel.postMessage({ type: "storage-changed" });
  }

  /**
   * Compute SHA-256 hash of an ArrayBuffer and return as hex string.
   */
  async hashBuffer(data: ArrayBuffer): Promise<string> {
    const digest = await crypto.subtle.digest("SHA-256", data);
    return Array.from(new Uint8Array(digest))
      .map((byte) => byte.toString(16).padStart(2, "0"))
      .join("");
  }

  /** Compute SHA-256 incrementally without materializing the complete input. */
  async hashStream(stream: ReadableStream<Uint8Array>, taskId?: string): Promise<string> {
    const controller = new AbortController();
    if (taskId) {
      this.hashControllers.get(taskId)?.abort();
      this.hashControllers.set(taskId, controller);
    }
    try {
      return await hashStreamIncrementally(stream, { signal: controller.signal });
    } finally {
      if (taskId && this.hashControllers.get(taskId) === controller) {
        this.hashControllers.delete(taskId);
      }
    }
  }

  /** Hash a browser File by consuming File.stream() inside the worker. */
  hashFile(file: File, taskId?: string): Promise<string> {
    return this.hashStream(file.stream(), taskId);
  }

  /** Cancel an in-flight incremental hash operation. */
  cancelHash(taskId: string): void {
    this.hashControllers.get(taskId)?.abort();
  }

  /** Fetch, hash, and parse a PBF in one streaming pass inside this worker. */
  async fromPbfUrl({
    url,
    options = {},
  }: {
    url: string;
    options?: Partial<OsmFromPbfOptions>;
  }): Promise<PbfUrlLoadResult> {
    const response = await fetch(url);
    if (!response.ok) {
      throw new Error(`Failed to fetch (${response.status}) ${response.statusText}`);
    }
    if (!response.body) throw new Error("The PBF response did not include a readable body.");
    const fileName = pbfFileName(response, url);
    const hasher = await createSHA256();
    hasher.init();
    let fileSize = 0;
    const hashingStream = new TransformStream<Uint8Array, Uint8Array>({
      transform(chunk, controller) {
        hasher.update(chunk);
        fileSize += chunk.byteLength;
        controller.enqueue(chunk);
      },
    });
    const provisionalId = `pbf-url-${crypto.randomUUID()}`;
    try {
      await super.fromPbf({
        data: response.body.pipeThrough(hashingStream),
        options: { ...options, id: provisionalId },
      });
      const fileHash = hasher.digest("hex");
      const provisional = this.get(provisionalId);
      const loadDecision = this.getLoadDecision(provisionalId);
      const osm = new Osm({ ...provisional.transferables(), id: fileHash });
      this.delete(provisionalId);
      this.set(fileHash, osm);
      this.setLoadDecision(fileHash, loadDecision);
      const existing = await this.findByHash(fileHash);
      return {
        info: osm.info(),
        fileInfo: { fileHash, fileName, fileSize, sourceUrl: url },
        existing,
      };
    } catch (error) {
      this.delete(provisionalId);
      throw error;
    }
  }

  /**
   * Find a stored entry by file hash.
   * Returns the stored entry metadata if found, null otherwise.
   */
  async findByHash(hash: string): Promise<StoredOsmEntry | null> {
    const db = await this.getDB();
    const stored = await db.getFromIndex(OSM_STORE, "by-hash", hash);
    if (!stored) return null;
    return {
      info: stored.info,
      storedAt: stored.storedAt,
      lastAccessedAt: stored.lastAccessedAt ?? stored.storedAt,
      fileHash: stored.fileHash,
      fileName: stored.fileName,
      fileSize: stored.fileSize,
      sourceUrl: stored.sourceUrl,
      loadDecision: stored.loadDecision ?? null,
      storedBytes: stored.storedBytes,
    };
  }

  /**
   * Store the currently-loaded Osm instance to IndexedDB.
   * The Osm must already be registered in the worker via fromPbf or similar.
   */
  async storeCurrentOsm(osmId: string, fileInfo: StoredFileInfo): Promise<void> {
    const osm = this.get(osmId);
    const transferables = osm.transferables();
    const info = osm.info();
    const loadDecision = this.getLoadDecision(osmId);
    const storedBytes = getOsmStorableBufferBytes(osm);
    const db = await this.getDB();
    const now = Date.now();

    await db.put(OSM_STORE, {
      ...toStorableTransferables(transferables),
      info,
      storedAt: now,
      lastAccessedAt: now,
      fileHash: fileInfo.fileHash,
      fileName: fileInfo.fileName,
      fileSize: fileInfo.fileSize,
      sourceUrl: fileInfo.sourceUrl,
      loadDecision,
      storedBytes,
    });
    this.notifyStorageChange();
  }

  /**
   * Load an Osm from IndexedDB by storage ID and register it in this worker.
   * Builds spatial indexes automatically after loading.
   * Updates the lastAccessedAt timestamp.
   * Returns the OsmInfo if found, null otherwise.
   */
  async loadFromStorage(
    storageId: string,
    updateLastAccessed = true,
    targetId?: string,
  ): Promise<{
    entry: StoredOsmEntry;
    info: OsmInfo;
  } | null> {
    const db = await this.getDB();
    const stored = await db.get(OSM_STORE, storageId);
    if (!stored) return null;

    const now = updateLastAccessed ? Date.now() : (stored.lastAccessedAt ?? stored.storedAt);
    if (updateLastAccessed) {
      stored.lastAccessedAt = now;
      await db.put(OSM_STORE, stored);
      this.notifyStorageChange();
    }

    // Convert from storage format and reconstruct Osm
    const transferables = fromStorableTransferables(stored);
    const osmId = targetId ?? stored.fileHash;
    const osm = new Osm({ ...transferables, id: osmId });
    const loadDecision = stored.loadDecision ?? null;
    if (loadDecision) buildSelectedOsmSpatialIndexes(osm, loadDecision.spatialIndexes);
    else buildOsmSpatialIndexesForProfile(osm, "full");

    // Register in worker (this also creates VT encoder and rebuilds routing graph if exists)
    this.set(osmId, osm);
    this.setLoadDecision(osmId, loadDecision);
    const info = osm.info();

    return {
      entry: {
        info,
        storedAt: stored.storedAt,
        lastAccessedAt: now,
        fileHash: stored.fileHash,
        fileName: stored.fileName,
        fileSize: stored.fileSize,
        sourceUrl: stored.sourceUrl,
        loadDecision,
        storedBytes: stored.storedBytes,
      },
      info,
    };
  }

  /**
   * Get all stored Osm entries (metadata only, not the full transferables).
   * Sorted by lastAccessedAt descending (most recently used first).
   */
  async listStoredOsm(): Promise<StoredOsmEntry[]> {
    const db = await this.getDB();
    const all = await db.getAll(OSM_STORE);
    return all
      .map((stored) => ({
        info: stored.info,
        storedAt: stored.storedAt,
        lastAccessedAt: stored.lastAccessedAt ?? stored.storedAt,
        fileHash: stored.fileHash,
        fileName: stored.fileName,
        fileSize: stored.fileSize,
        sourceUrl: stored.sourceUrl,
        loadDecision: stored.loadDecision ?? null,
        storedBytes: stored.storedBytes,
      }))
      .sort((a, b) => b.lastAccessedAt - a.lastAccessedAt);
  }

  /**
   * Delete a stored Osm entry from IndexedDB.
   */
  async deleteStoredOsm(id: string): Promise<void> {
    const db = await this.getDB();
    await db.delete(OSM_STORE, id);
    this.delete(id);
    this.broadcastChannel.postMessage({ type: "delete", id });
    this.notifyStorageChange();
  }

  /**
   * Rename a stored Osm entry in IndexedDB.
   */
  async renameStoredOsm(id: string, newFileName: string): Promise<void> {
    const db = await this.getDB();
    const stored = await db.get(OSM_STORE, id);
    if (!stored) return;

    stored.fileName = newFileName;
    await db.put(OSM_STORE, stored);
    this.notifyStorageChange();
  }

  /**
   * Get storage statistics.
   */
  async getStorageStats(): Promise<{ count: number; estimatedBytes: number }> {
    const db = await this.getDB();
    const all = await db.getAll(OSM_STORE);
    const estimatedBytes = all.reduce((total, stored) => total + stored.storedBytes, 0);
    return { count: all.length, estimatedBytes };
  }

  /** Exact buffer payload that would be persisted, excluding rebuildable spatial indexes. */
  getStorableByteLength(osmId: string): number {
    return getOsmStorableBufferBytes(this.get(osmId));
  }

  /**
   * Get the most recently accessed stored Osm entry.
   * Returns null if no entries exist.
   */
  async getMostRecentlyUsed(): Promise<StoredOsmEntry | null> {
    const db = await this.getDB();
    const all = await db.getAll(OSM_STORE);
    if (all.length === 0) return null;

    // Find the entry with the highest lastAccessedAt (or storedAt as fallback)
    let mostRecent = all[0];
    let mostRecentTime = mostRecent.lastAccessedAt ?? mostRecent.storedAt;
    for (const stored of all) {
      const accessTime = stored.lastAccessedAt ?? stored.storedAt;
      if (accessTime > mostRecentTime) {
        mostRecent = stored;
        mostRecentTime = accessTime;
      }
    }

    return {
      info: mostRecent.info,
      storedAt: mostRecent.storedAt,
      lastAccessedAt: mostRecent.lastAccessedAt ?? mostRecent.storedAt,
      fileHash: mostRecent.fileHash,
      fileName: mostRecent.fileName,
      fileSize: mostRecent.fileSize,
      sourceUrl: mostRecent.sourceUrl,
      loadDecision: mostRecent.loadDecision ?? null,
      storedBytes: mostRecent.storedBytes,
    };
  }
}

// ---------------------------------------------------------------------------
// Helper functions for converting transferables to/from storable format
// ---------------------------------------------------------------------------

/**
 * Convert a buffer (possibly SharedArrayBuffer) to a regular ArrayBuffer.
 * IndexedDB cannot store SharedArrayBuffer, so we need to copy the data.
 */
function toArrayBuffer(buffer: ArrayBuffer | SharedArrayBuffer | ArrayBufferLike): ArrayBuffer {
  if (buffer instanceof ArrayBuffer) {
    return buffer;
  }
  // Copy SharedArrayBuffer to ArrayBuffer
  const copy = new ArrayBuffer(buffer.byteLength);
  new Uint8Array(copy).set(new Uint8Array(buffer));
  return copy;
}

/**
 * Convert an ArrayBuffer to a SharedArrayBuffer for cross-worker sharing.
 * Returns the buffer unchanged when SharedArrayBuffers cannot be shared
 * (non-cross-origin-isolated contexts) — Osm accepts either buffer type.
 */
function toSharedArrayBuffer(buffer: ArrayBuffer): BufferType {
  if (!canShareArrayBuffers()) return buffer;
  const copy = new SharedArrayBuffer(buffer.byteLength);
  new Uint8Array(copy).set(new Uint8Array(buffer));
  return copy;
}

/** The ID and tag buffers shared by every entity collection's transferables. */
interface SharedEntityTransferables<B> {
  ids: B;
  sortedIds?: B;
  sortedIdPositionToIndex?: B;
  anchors: B;
  idsAreSorted: boolean;
  tagEntityCount: number;
  taggedEntityBits: B;
  tagRankCheckpoints: B;
  tagOffsets: B;
  tagKeys: B;
  tagVals: B;
  keyEntities: B;
  keyIndexStart: B;
  keyIndexCount: B;
}

/**
 * Map the buffers shared by node, way, and relation transferables through one
 * converter. Keeping a single field list prevents the storable and runtime
 * conversions from drifting apart when the transfer schema changes.
 */
function convertEntityTransferables<In, Out>(
  t: SharedEntityTransferables<In>,
  convert: (buffer: In) => Out,
): SharedEntityTransferables<Out> {
  return {
    ids: convert(t.ids),
    ...(t.sortedIds !== undefined ? { sortedIds: convert(t.sortedIds) } : {}),
    ...(t.sortedIdPositionToIndex !== undefined
      ? { sortedIdPositionToIndex: convert(t.sortedIdPositionToIndex) }
      : {}),
    anchors: convert(t.anchors),
    idsAreSorted: t.idsAreSorted,
    tagEntityCount: t.tagEntityCount,
    taggedEntityBits: convert(t.taggedEntityBits),
    tagRankCheckpoints: convert(t.tagRankCheckpoints),
    tagOffsets: convert(t.tagOffsets),
    tagKeys: convert(t.tagKeys),
    tagVals: convert(t.tagVals),
    keyEntities: convert(t.keyEntities),
    keyIndexStart: convert(t.keyIndexStart),
    keyIndexCount: convert(t.keyIndexCount),
  };
}

/**
 * Convert OsmTransferables to a storable format with regular ArrayBuffers.
 * Spatial indexes are excluded since they can be rebuilt from the data.
 */
function toStorableTransferables(t: OsmTransferables): OsmTransferables<ArrayBuffer> {
  return {
    transferVersion: t.transferVersion,
    contentHashVersion: t.contentHashVersion,
    id: t.id,
    header: t.header,
    contentHash: t.contentHash,
    ...(t.loadDiagnostics ? { loadDiagnostics: t.loadDiagnostics } : {}),
    stringTable: {
      bytes: toArrayBuffer(t.stringTable.bytes),
      start: toArrayBuffer(t.stringTable.start),
      count: toArrayBuffer(t.stringTable.count),
    },
    nodes: {
      ...convertEntityTransferables(t.nodes, toArrayBuffer),
      lons: toArrayBuffer(t.nodes.lons),
      lats: toArrayBuffer(t.nodes.lats),
      bbox: t.nodes.bbox,
    },
    ways: {
      ...convertEntityTransferables(t.ways, toArrayBuffer),
      refStart: toArrayBuffer(t.ways.refStart),
      refCount: toArrayBuffer(t.ways.refCount),
      refs: toArrayBuffer(t.ways.refs),
      missingRefPositions: toArrayBuffer(t.ways.missingRefPositions),
      missingRefIds: toArrayBuffer(t.ways.missingRefIds),
      bbox: toArrayBuffer(t.ways.bbox),
    },
    relations: {
      ...convertEntityTransferables(t.relations, toArrayBuffer),
      memberStart: toArrayBuffer(t.relations.memberStart),
      memberCount: toArrayBuffer(t.relations.memberCount),
      memberRefs: toArrayBuffer(t.relations.memberRefs),
      memberTypes: toArrayBuffer(t.relations.memberTypes),
      memberRoles: toArrayBuffer(t.relations.memberRoles),
      bbox: toArrayBuffer(t.relations.bbox),
    },
  };
}

/**
 * Convert stored OsmTransferables back to worker-ready buffers
 * (SharedArrayBuffers when shareable, plain ArrayBuffers otherwise).
 */
function fromStorableTransferables(t: OsmTransferables<ArrayBuffer>): OsmTransferables<BufferType> {
  return {
    transferVersion: t.transferVersion,
    contentHashVersion: t.contentHashVersion,
    id: t.id,
    header: t.header,
    contentHash: t.contentHash,
    ...(t.loadDiagnostics ? { loadDiagnostics: t.loadDiagnostics } : {}),
    stringTable: {
      bytes: toSharedArrayBuffer(t.stringTable.bytes),
      start: toSharedArrayBuffer(t.stringTable.start),
      count: toSharedArrayBuffer(t.stringTable.count),
    },
    nodes: {
      ...convertEntityTransferables(t.nodes, toSharedArrayBuffer),
      lons: toSharedArrayBuffer(t.nodes.lons),
      lats: toSharedArrayBuffer(t.nodes.lats),
      bbox: t.nodes.bbox,
    },
    ways: {
      ...convertEntityTransferables(t.ways, toSharedArrayBuffer),
      refStart: toSharedArrayBuffer(t.ways.refStart),
      refCount: toSharedArrayBuffer(t.ways.refCount),
      refs: toSharedArrayBuffer(t.ways.refs),
      missingRefPositions: toSharedArrayBuffer(t.ways.missingRefPositions),
      missingRefIds: toSharedArrayBuffer(t.ways.missingRefIds),
      bbox: toSharedArrayBuffer(t.ways.bbox),
    },
    relations: {
      ...convertEntityTransferables(t.relations, toSharedArrayBuffer),
      memberStart: toSharedArrayBuffer(t.relations.memberStart),
      memberCount: toSharedArrayBuffer(t.relations.memberCount),
      memberRefs: toSharedArrayBuffer(t.relations.memberRefs),
      memberTypes: toSharedArrayBuffer(t.relations.memberTypes),
      memberRoles: toSharedArrayBuffer(t.relations.memberRoles),
      bbox: toSharedArrayBuffer(t.relations.bbox),
    },
  };
}

expose(new MergeWorker());
