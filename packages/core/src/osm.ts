import type { OsmPbfHeaderBlock } from "@osmix/pbf";
import { ContentHasher } from "@osmix/shared/content-hasher";
import type { GeoBbox2D } from "@osmix/types";

import { Nodes, type NodesTransferables } from "./nodes.ts";
import { Relations, type RelationsTransferables } from "./relations.ts";
import StringTable, { type StringTableTransferables } from "./stringtable.ts";
import type { BufferType } from "./typed-arrays.ts";
import { Ways, type WaysTransferables } from "./ways.ts";

export const OSM_TRANSFER_VERSION = 2 as const;
export const OSM_CONTENT_HASH_VERSION = 2 as const;

export interface OsmTransferables<T extends BufferType = BufferType> {
  transferVersion: typeof OSM_TRANSFER_VERSION;
  contentHashVersion: typeof OSM_CONTENT_HASH_VERSION;
  id: string;
  header: OsmPbfHeaderBlock;
  contentHash: string;
  loadDiagnostics?: OsmLoadDiagnostics;
  stringTable: StringTableTransferables<T>;
  nodes: NodesTransferables<T>;
  ways: WaysTransferables<T>;
  relations: RelationsTransferables<T>;
}

export type OsmLoadProfile = "auto" | "full" | "view";
export type ResolvedOsmLoadProfile = Exclude<OsmLoadProfile, "auto">;

export interface OsmLoadDiagnosticReason {
  code: string;
  level: "info" | "warning";
  message: string;
}

/** Plain-data diagnostics attached by loaders and safe to transfer between workers. */
export interface OsmLoadDiagnostics {
  requestedProfile: OsmLoadProfile;
  selectedProfile: ResolvedOsmLoadProfile;
  reasons: OsmLoadDiagnosticReason[];
  bytes: {
    residentTypedBuffers: number;
    projectedTypedBufferPeak: number;
    largestPlannedAllocation: number;
    storageBytes?: number;
  };
  budgets: {
    workingSet?: number;
    singleAllocation?: number;
    allNodeSpatialIndex?: number;
    arrayBufferCeiling?: number;
    sharedArrayBufferCeiling?: number;
  };
  phaseTimingsMs: Record<string, number>;
  counters: {
    taggedNodes?: number;
    taggedWays?: number;
    taggedRelations?: number;
    nodeTagPairs?: number;
    wayTagPairs?: number;
    relationTagPairs?: number;
    wayReferences?: number;
    missingWayReferences?: number;
    relationMembers?: number;
  };
}

export interface OsmInfo {
  id: string;
  bbox: GeoBbox2D;
  header: OsmPbfHeaderBlock;
  stats: {
    nodes: number;
    ways: number;
    relations: number;
  };
  spatialIndexes: {
    nodes: { all: boolean; tagged: boolean };
    ways: boolean;
    relations: boolean;
  };
  loadDiagnostics?: OsmLoadDiagnostics;
}

export interface OsmOptions {
  id: string;
  header: OsmPbfHeaderBlock;
}

/**
 * OSM Entity Index.
 */
export class Osm {
  // Filename or ID of this OSM Entity index.
  readonly id: string;
  readonly header: OsmPbfHeaderBlock;

  // Shared string lookup table for all nodes, ways, and relations
  readonly stringTable: StringTable;
  readonly nodes: Nodes;
  readonly ways: Ways;
  readonly relations: Relations;

  private indexBuilt = false;
  private _contentHash = "";
  private _loadDiagnostics?: OsmLoadDiagnostics;

  /**
   * Create a new OSM Entity index.
   */
  constructor(opts?: Partial<OsmOptions> | OsmTransferables | Osm) {
    this.id = opts?.id ?? "unknown";
    this.header = opts?.header ?? {
      required_features: [],
      optional_features: [],
    };
    if (opts && "stringTable" in opts) {
      if (opts instanceof Osm) {
        this.stringTable = new StringTable(opts.stringTable.transferables());
        this.nodes = new Nodes(this.stringTable, opts.nodes.transferables());
        this.ways = new Ways(this.stringTable, this.nodes, opts.ways.transferables());
        this.relations = new Relations(
          this.stringTable,
          this.nodes,
          this.ways,
          opts.relations.transferables(),
        );
        this._contentHash = opts._contentHash;
        this._loadDiagnostics = opts._loadDiagnostics;
        this.indexBuilt = true;
      } else {
        if (opts.transferVersion !== OSM_TRANSFER_VERSION) {
          throw Error(
            `Unsupported OSM transfer version: ${String(opts.transferVersion)}. Expected ${String(OSM_TRANSFER_VERSION)}.`,
          );
        }
        if (opts.contentHashVersion !== OSM_CONTENT_HASH_VERSION) {
          throw Error(
            `Unsupported OSM content hash version: ${String(opts.contentHashVersion)}. Expected ${String(OSM_CONTENT_HASH_VERSION)}.`,
          );
        }
        this.stringTable = new StringTable(opts.stringTable);
        this.nodes = new Nodes(this.stringTable, opts.nodes);
        this.ways = new Ways(this.stringTable, this.nodes, opts.ways);
        this.relations = new Relations(this.stringTable, this.nodes, this.ways, opts.relations);
        this._contentHash = opts.contentHash;
        this._loadDiagnostics = opts.loadDiagnostics;
        this.indexBuilt = true;
      }
    } else {
      this.stringTable = new StringTable();
      this.nodes = new Nodes(this.stringTable);
      this.ways = new Ways(this.stringTable, this.nodes);
      this.relations = new Relations(this.stringTable, this.nodes, this.ways);
    }
  }

  /**
   * Build the internal indexes for all entities.
   * Also computes the content hash after indexes are built.
   */
  buildIndexes() {
    this.stringTable.buildIndex();
    this.nodes.buildIndex();
    this.ways.buildIndex();
    this.relations.buildIndex();
    this.indexBuilt = true;
    // Compute content hash after indexes are built
    this._contentHash = this.computeContentHash();
  }

  /**
   * Check if the index is built and ready for use.
   */
  isReady() {
    return (
      this.nodes.isReady() && this.ways.isReady() && this.relations.isReady() && this.indexBuilt
    );
  }

  /**
   * Build spatial indexes for all entities.
   */
  buildSpatialIndexes() {
    this.nodes.buildSpatialIndex("tagged");
    this.nodes.buildSpatialIndex();
    this.ways.buildSpatialIndex();
    this.relations.buildSpatialIndex();
  }

  /**
   * Check if spatial indexes have been built for all entity types.
   */
  hasSpatialIndexes(): boolean {
    return (
      this.nodes.hasSpatialIndex() &&
      this.nodes.hasSpatialIndex("tagged") &&
      this.ways.hasSpatialIndex() &&
      this.relations.hasSpatialIndex()
    );
  }

  /**
   * Get the bounding box of all entities in the OSM index.
   */
  bbox(): GeoBbox2D {
    return this.nodes.getBbox();
  }

  /**
   * Get information about the OSM index.
   */
  info(): OsmInfo {
    return {
      id: this.id,
      bbox: this.bbox(),
      header: this.header,
      stats: {
        nodes: this.nodes.size,
        ways: this.ways.size,
        relations: this.relations.size,
      },
      spatialIndexes: {
        nodes: {
          all: this.nodes.hasSpatialIndex("all"),
          tagged: this.nodes.hasSpatialIndex("tagged"),
        },
        ways: this.ways.hasSpatialIndex(),
        relations: this.relations.hasSpatialIndex(),
      },
      ...(this._loadDiagnostics ? { loadDiagnostics: this._loadDiagnostics } : {}),
    };
  }

  /** Attach loader-provided diagnostics for `info()` and worker transfer. */
  setLoadDiagnostics(loadDiagnostics: OsmLoadDiagnostics | undefined): void {
    this._loadDiagnostics = loadDiagnostics;
  }

  /**
   * Get transferable objects for passing to another thread.
   */
  transferables(): OsmTransferables {
    return {
      transferVersion: OSM_TRANSFER_VERSION,
      contentHashVersion: OSM_CONTENT_HASH_VERSION,
      id: this.id,
      header: this.header,
      contentHash: this._contentHash,
      ...(this._loadDiagnostics ? { loadDiagnostics: this._loadDiagnostics } : {}),
      stringTable: this.stringTable.transferables(),
      nodes: this.nodes.transferables(),
      ways: this.ways.transferables(),
      relations: this.relations.transferables(),
    };
  }

  /**
   * Get the content hash of this OSM dataset.
   * The hash is computed when indexes are built.
   *
   * @returns A hex string hash uniquely identifying the content.
   */
  contentHash(): string {
    return this._contentHash;
  }

  /**
   * Check if this OSM dataset has identical content to another.
   * Uses the pre-computed content hash for fast comparison.
   *
   * @param other - The other Osm instance to compare with.
   * @returns True if both datasets have identical content.
   */
  isEqual(other: Osm | null | undefined): boolean {
    if (!other) return false;
    return this._contentHash === other._contentHash;
  }

  /**
   * Compute a content hash of all underlying data.
   * This hash uniquely identifies the dataset content regardless of metadata.
   *
   * @returns A hex string hash of the content.
   */
  private computeContentHash(): string {
    const hasher = new ContentHasher().updateNumber(OSM_CONTENT_HASH_VERSION);
    // Hash string table first (shared by all entities)
    this.stringTable.updateHash(hasher);
    // Hash each entity collection
    this.nodes.updateHash(hasher);
    this.ways.updateHash(hasher);
    this.relations.updateHash(hasher);
    return hasher.digest();
  }
}
