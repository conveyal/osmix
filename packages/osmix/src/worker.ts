/**
 * Worker implementation for OSM operations.
 *
 * OsmixWorker runs inside a browser Worker or Node worker thread and manages multiple Osm instances.
 * It exposes methods via Comlink for cross-thread RPC from OsmixRemote.
 *
 * Can be extended to add custom functionality:
 * @example
 * ```ts
 * class MyWorker extends OsmixWorker {
 *   myCustomMethod(osmId: string) {
 *     const osm = this.get(osmId)
 *     // ... custom logic
 *   }
 * }
 * ```
 *
 * @module
 */

import {
  applyChangesetToOsm,
  applyPlan,
  generateMergePlanOsc,
  merge,
  type MergePlan,
  type PlanDecision,
  planMerge,
  planWithinDatasetDeduplication,
  setMergePlanDecisions,
  type OsmChange,
  type OsmChangeset,
  type OsmChangeTypes,
  type MergePlanOptions,
} from "@osmix/change";
import {
  negativeIdMap,
  Osm,
  type OsmIdMap,
  type OsmOptions,
  type OsmTransferables,
  renumberNegativeIds,
} from "@osmix/core";
import { fromGeoJSON } from "@osmix/geojson";
import { fromGeoParquet, type GeoParquetReadOptions } from "@osmix/geoparquet";
import { fromGtfs, type GtfsConversionOptions } from "@osmix/gtfs";
import {
  type DefaultSpeeds,
  type HighwayFilter,
  type RouteOptions,
  type RouteResult,
  Router,
  RoutingGraph,
  type RoutingGraphTransferables,
  type WaySegment,
} from "@osmix/router";
import { fromShapefile } from "@osmix/shapefile";
import type { Progress, ProgressEvent } from "@osmix/shared/progress";
import { streamToBytes } from "@osmix/shared/stream-to-bytes";
import type { LonLat, OsmEntityType, Tile } from "@osmix/types";

// Re-export types from router for backwards compatibility
export type { RouteResult, WaySegment };

interface PlanSession {
  patchOsmId: string;
  plan: MergePlan;
  filter: MergePlanFilter;
}

/** Changes waiting to be reviewed page by page and applied: Inspect's duplicate fixes. */
type GeneratedChangeset = {
  changeset: OsmChangeset;
  patchOsmId: string;
};

/** `Blob` parts cannot be views of a `SharedArrayBuffer`. */
function isArrayBufferBacked(chunk: Uint8Array): chunk is Uint8Array<ArrayBuffer> {
  return chunk.buffer instanceof ArrayBuffer;
}

import {
  fromPbf,
  getOsmLoadDecision as getStoredOsmLoadDecision,
  type OsmLoadDecision,
  type OsmFromPbfOptions,
  readOsmPbfHeader,
  toPbfBuffer,
  toPbfStream,
} from "@osmix/load";
import { OsmixVtEncoder } from "@osmix/vt";
import * as Comlink from "comlink";
import { dequal } from "dequal/lite";

import { installStructuredComlinkErrorTransferHandler } from "./comlink-errors.ts";
import {
  bulkDecisions,
  type MergePlanBulkRequest,
  type MergePlanBulkResult,
  type MergePlanFilter,
  planFeatureDetail,
  planLayer,
  planOverview,
  planPage,
} from "./plan-session.ts";
import { type DrawToRasterTileOptions, drawToRasterTile } from "./raster.ts";
import { transfer } from "./utils.ts";

installStructuredComlinkErrorTransferHandler();

/**
 * Worker handler for managing multiple Osm instances off the calling thread.
 * Exposes Comlink-wrapped methods for off-thread Osm data operations.
 */
export class OsmixWorker extends EventTarget {
  private osm = new Map<string, Osm>();
  private loadDecisions = new Map<string, OsmLoadDecision>();
  private vtEncoders = new Map<string, OsmixVtEncoder>();
  private graphs = new Map<string, RoutingGraph>();
  private changesets = new Map<string, GeneratedChangeset>();
  private plans = new Map<string, PlanSession>();
  private changeTypes: OsmChangeTypes[] = ["create", "modify", "delete"];
  private entityTypes: OsmEntityType[] = ["node", "way", "relation"];
  private filteredChanges = new Map<string, OsmChange[]>();

  private onProgress = (progress: ProgressEvent) => this.dispatchEvent(progress);

  /** Confirm that the worker RPC endpoint is ready to receive operations. */
  ping(): true {
    return true;
  }

  /**
   * Register a progress listener to receive updates during long-running operations.
   * Listener is proxied through Comlink for cross-thread communication.
   */
  addProgressListener(listener: (progress: Progress) => void) {
    this.addEventListener("progress", (e: Event) => listener((e as ProgressEvent).detail));
  }

  /**
   * Read only the header from PBF data without parsing entities.
   * Delegates to readHeader method.
   */
  readHeader(data: ArrayBufferLike | ReadableStream) {
    return readOsmPbfHeader(data instanceof ReadableStream ? data : new Uint8Array(data));
  }

  /**
   * Load an Osm instance from PBF data and store it in this worker.
   * Returns Osm metadata including entity counts and bbox.
   */
  async fromPbf({
    data,
    options,
  }: {
    data: ArrayBufferLike | ReadableStream;
    options?: Partial<OsmFromPbfOptions>;
  }) {
    const osm = await fromPbf(
      data instanceof ReadableStream ? data : new Uint8Array(data),
      options,
      this.onProgress,
    );
    this.set(osm.id, osm);
    const decision = getStoredOsmLoadDecision(osm);
    this.setLoadDecision(osm.id, decision);
    return osm.info();
  }

  /**
   * Serialize an Osm instance to PBF and pipe into the provided writable stream.
   * Stream is transferred from the main thread for zero-copy efficiency.
   */
  toPbfStream({
    osmId,
    writeableStream,
  }: {
    osmId: string;
    writeableStream: WritableStream<Uint8Array>;
  }) {
    return toPbfStream(this.get(osmId)).pipeTo(writeableStream);
  }

  /**
   * Serialize an Osm instance to a single PBF buffer.
   * Result is transferred back to the main thread.
   */
  async toPbf(osmId: string) {
    const data = await toPbfBuffer(this.get(osmId));
    return Comlink.transfer(data, [data.buffer]);
  }

  /**
   * Serialize an Osm instance to PBF and write it through a file handle.
   * The handle is structured-cloneable, so the worker writes to disk without a main-thread hop.
   */
  async toPbfFile({
    osmId,
    fileHandle,
    renumberNegativeIds: renumber = false,
  }: {
    osmId: string;
    fileHandle: FileSystemFileHandle;
    /** Export new (negative-ID) entities with positive IDs; see `renumberNegativeIds`. */
    renumberNegativeIds?: boolean;
  }) {
    await toPbfStream(this.exportOsm(osmId, renumber)).pipeTo(await fileHandle.createWritable());
  }

  /** The dataset to export: as loaded, or with negative IDs renumbered to positive ones. */
  private exportOsm(osmId: string, renumber: boolean): Osm {
    const osm = this.get(osmId);
    return renumber ? renumberNegativeIds(osm).osm : osm;
  }

  /** The old → new IDs a positive-ID export of this dataset uses. */
  negativeIdMap(osmId: string): OsmIdMap {
    return negativeIdMap(this.get(osmId));
  }

  /**
   * Serialize an Osm instance to a PBF `Blob`.
   * Chunks are not concatenated, and posting a `Blob` shares it instead of copying its bytes.
   */
  async toPbfBlob(
    osmId: string,
    { renumberNegativeIds: renumber = false }: { renumberNegativeIds?: boolean } = {},
  ): Promise<Blob> {
    const chunks: Uint8Array<ArrayBuffer>[] = [];
    await toPbfStream(this.exportOsm(osmId, renumber)).pipeTo(
      new WritableStream({
        write(chunk) {
          if (!isArrayBufferBacked(chunk)) throw Error("PBF writer emitted a shared-memory chunk.");
          chunks.push(chunk);
        },
      }),
    );
    return new Blob(chunks, { type: "application/x-protobuf" });
  }

  /**
   * Load an Osm instance from GeoJSON data and store it in this worker.
   * Returns Osm metadata including entity counts and bbox.
   */
  async fromGeoJSON({
    data,
    options,
  }: {
    data: ArrayBufferLike | ReadableStream;
    options?: Partial<OsmOptions>;
  }) {
    const osm = await fromGeoJSON(data, options, this.onProgress);
    this.set(osm.id, osm);
    return osm.info();
  }

  /**
   * Load an Osm instance from Shapefile (ZIP) data and store it in this worker.
   * Returns Osm metadata including entity counts and bbox.
   */
  async fromShapefile({
    data,
    options,
  }: {
    data: ArrayBufferLike | ReadableStream;
    options?: Partial<OsmOptions>;
  }) {
    const osm = await fromShapefile(data, options, this.onProgress);
    this.set(osm.id, osm);
    return osm.info();
  }

  /**
   * Load an Osm instance from GeoParquet data and store it in this worker.
   * Returns Osm metadata including entity counts and bbox.
   */
  async fromGeoParquet({
    data,
    options,
    readOptions,
  }: {
    data: ArrayBuffer | string | URL;
    options?: Partial<OsmOptions>;
    readOptions?: GeoParquetReadOptions;
  }) {
    const osm = await fromGeoParquet(data, options, readOptions, this.onProgress);
    this.set(osm.id, osm);
    return osm.info();
  }

  /**
   * Load an Osm instance from GTFS (ZIP) data and store it in this worker.
   * Returns Osm metadata including entity counts and bbox.
   */
  async fromGtfs({
    data,
    options,
    gtfsOptions,
  }: {
    data: ArrayBufferLike | ReadableStream;
    options?: Partial<OsmOptions>;
    gtfsOptions?: GtfsConversionOptions;
  }) {
    const osm = await fromGtfs(
      data instanceof ReadableStream
        ? new Uint8Array(await streamToBytes(data))
        : new Uint8Array(data),
      options,
      gtfsOptions,
      this.onProgress,
    );
    this.set(osm.id, osm);
    return osm.info();
  }

  /**
   * Accept transferables from another worker or main thread and reconstruct an Osm instance.
   * Used when SharedArrayBuffer is supported to share data across workers.
   */
  transferIn(transferables: OsmTransferables, loadDecision?: OsmLoadDecision | null) {
    this.set(transferables.id, new Osm(transferables));
    this.setLoadDecision(transferables.id, loadDecision ?? null);
  }

  /**
   * Transfer an Osm instance out of this worker and remove it.
   * Transfers underlying buffers for efficient cross-thread movement.
   */
  transferOut(id: string) {
    const transferables = this.get(id).transferables();
    this.delete(id);
    return transfer(transferables);
  }

  /**
   * Get the raw transferable buffers for an Osm instance without removing it.
   * Used to duplicate data across workers when SharedArrayBuffer is available.
   */
  getOsmBuffers(id: string) {
    return this.get(id).transferables();
  }

  /** Return the profile decision recorded while loading a PBF dataset. */
  /** The dataset's content hash, to check that restored data is what a session was made from. */
  contentHash(id: string): string {
    return this.get(id).contentHash();
  }

  getLoadDecision(id: string): OsmLoadDecision | null {
    return this.loadDecisions.get(id) ?? null;
  }

  /**
   * Check if an Osm instance with the given ID exists in this worker.
   */
  has(id: string): boolean {
    return this.osm.has(id);
  }

  /**
   * Check if an Osm instance has completed index building and is ready for queries.
   */
  isReady(id: string): boolean {
    return this.osm.get(id)?.isReady() ?? false;
  }

  /**
   * Retrieve an Osm instance by ID, throwing if not found.
   * Protected to allow subclasses to access stored Osmix instances.
   */
  protected get(id: string) {
    const osm = this.osm.get(id);
    if (!osm) throw Error(`OSM not found for id: ${id}`);
    return osm;
  }

  /**
   * Store an Osm instance by ID, replacing any existing instance with the same ID.
   * Protected to allow subclasses to manage Osm instances. If a routing graph exists,
   * rebuild it.
   */
  protected set(id: string, osm: Osm) {
    this.invalidateMergeStateForDataset(id);
    this.osm.set(id, osm);
    this.loadDecisions.delete(id);
    this.vtEncoders.set(id, new OsmixVtEncoder(osm));
    const graph = this.graphs.get(id);
    if (graph) {
      this.buildRoutingGraph(id, graph.filter, graph.defaultSpeeds);
    }
  }

  /** Record load-profile diagnostics for datasets reconstructed by subclasses. */
  protected setLoadDecision(id: string, decision: OsmLoadDecision | null): void {
    if (decision) this.loadDecisions.set(id, decision);
    else this.loadDecisions.delete(id);
  }

  /**
   * Remove an Osm instance from this worker, freeing its memory.
   */
  delete(id: string) {
    this.invalidateMergeStateForDataset(id);
    this.osm.delete(id);
    this.loadDecisions.delete(id);
    this.vtEncoders.delete(id);
    this.graphs.delete(id);
    this.changesets.delete(id);
    this.filteredChanges.delete(id);
  }

  private invalidateMergeStateForDataset(osmId: string) {
    for (const [baseOsmId, session] of this.plans) {
      if (baseOsmId === osmId || session.patchOsmId === osmId) this.plans.delete(baseOsmId);
    }
    for (const [baseOsmId, generated] of this.changesets) {
      if (baseOsmId === osmId || generated.patchOsmId === osmId) {
        this.changesets.delete(baseOsmId);
        this.filteredChanges.delete(baseOsmId);
      }
    }
  }

  // ---------------------------------------------------------------------------
  // Routing
  // ---------------------------------------------------------------------------

  /**
   * Build a routing graph for an Osm instance.
   * The graph is stored internally and can be shared via transferables.
   *
   * @param osmId - ID of the Osm instance to build a graph for.
   * @param filter - Optional filter function to determine which ways are routable.
   * @param defaultSpeeds - Optional speed limits by highway type.
   * @returns Graph statistics (node and edge counts).
   */
  buildRoutingGraph(osmId: string, filter?: HighwayFilter, defaultSpeeds?: DefaultSpeeds) {
    const osm = this.get(osmId);
    const graph = new RoutingGraph(osm, filter, defaultSpeeds);
    this.graphs.set(osmId, graph);
    return { nodeCount: graph.size, edgeCount: graph.edges };
  }

  /**
   * Check if a routing graph exists for an Osm instance.
   */
  hasRoutingGraph(osmId: string): boolean {
    return this.graphs.has(osmId);
  }

  /**
   * Get the routing graph for an Osm instance.
   * Auto-builds the graph on first access if it doesn't exist.
   * @throws If the graph cannot be built.
   */
  protected getGraph(osmId: string): RoutingGraph {
    let graph = this.graphs.get(osmId);
    if (!graph) {
      // Auto-build on first access
      this.buildRoutingGraph(osmId);
      graph = this.graphs.get(osmId);
    }
    if (!graph) throw Error(`Failed to build routing graph for: ${osmId}`);
    return graph;
  }

  /**
   * Get routing graph transferables for sharing with other workers.
   * @param osmId - ID of the Osm instance.
   * @returns Transferable buffers for the routing graph.
   */
  getRoutingGraphTransferables(osmId: string): RoutingGraphTransferables {
    return this.getGraph(osmId).transferables();
  }

  /**
   * Accept a routing graph from another worker or main thread.
   * Used to share pre-built graphs across workers.
   *
   * @param osmId - ID to associate with the graph.
   * @param transferables - Routing graph transferables.
   */
  transferRoutingGraphIn(osmId: string, transferables: RoutingGraphTransferables) {
    this.graphs.set(osmId, new RoutingGraph(transferables));
  }

  /**
   * Find the nearest routable node to a geographic point.
   *
   * @param osmId - ID of the Osm instance.
   * @param point - [lon, lat] coordinates to search from.
   * @param maxDistanceM - Maximum search radius in meters.
   * @returns Nearest routable node info, or null if none found.
   */
  findNearestRoutableNode(osmId: string, point: LonLat, maxDistanceM: number) {
    return this.getGraph(osmId).findNearestRoutableNode(this.get(osmId), point, maxDistanceM);
  }

  /**
   * Calculate a route between two node indexes.
   *
   * @param osmId - ID of the Osm instance.
   * @param fromIndex - Starting node index.
   * @param toIndex - Destination node index.
   * @param options - Optional routing options (algorithm, metric).
   * @returns Route result with coordinates and way info, or null if no route found.
   */
  route(
    osmId: string,
    fromIndex: number,
    toIndex: number,
    options?: Partial<RouteOptions>,
  ): RouteResult | null {
    const osm = this.get(osmId);
    const graph = this.getGraph(osmId);
    const router = new Router(osm, graph, options);
    const path = router.route(fromIndex, toIndex, options);
    if (!path) return null;
    return router.buildResult(path, options);
  }

  // ---------------------------------------------------------------------------
  // Vector & Raster Tiles
  // ---------------------------------------------------------------------------

  /**
   * Generate a Mapbox Vector Tile for the specified tile coordinates.
   * Returns transferred MVT data suitable for MapLibre rendering.
   */
  getVectorTile(id: string, tile: Tile) {
    const data = this.vtEncoders.get(id)?.getTile(tile);
    if (!data || data.byteLength === 0) return new ArrayBuffer(0);
    return Comlink.transfer(data, [data]);
  }

  /**
   * Generate a raster tile as ImageData for the specified tile coordinates.
   * Returns transferred RGBA pixel data suitable for canvas rendering.
   */
  getRasterTile(id: string, tile: Tile, opts?: DrawToRasterTileOptions) {
    const data = drawToRasterTile(this.get(id), tile, opts).imageData;
    if (!data || data.byteLength === 0) return new Uint8ClampedArray(0);
    return Comlink.transfer(data, [data.buffer]);
  }

  /**
   * Search for entities by tag key and optional value.
   * Returns matching nodes, ways, and relations.
   */
  search(id: string, key: string, val?: string) {
    const osm = this.get(id);
    const nodes = osm.nodes.search(key, val);
    const ways = osm.ways.search(key, val);
    const relations = osm.relations.search(key, val);
    return { nodes, ways, relations };
  }

  // ---------------------------------------------------------------------------
  // Entity collection proxies
  // ---------------------------------------------------------------------------

  nodesSize(osmId: string) {
    return this.get(osmId).nodes.size;
  }

  nodesGetById(osmId: string, nodeId: number) {
    return this.get(osmId).nodes.getById(nodeId);
  }

  nodesSearch(osmId: string, key: string, val?: string) {
    return this.get(osmId).nodes.search(key, val);
  }

  waysSize(osmId: string) {
    return this.get(osmId).ways.size;
  }

  waysGetById(osmId: string, wayId: number) {
    return this.get(osmId).ways.getById(wayId);
  }

  waysSearch(osmId: string, key: string, val?: string) {
    return this.get(osmId).ways.search(key, val);
  }

  relationsSize(osmId: string) {
    return this.get(osmId).relations.size;
  }

  relationsGetById(osmId: string, relationId: number) {
    return this.get(osmId).relations.getById(relationId);
  }

  relationsSearch(osmId: string, key: string, val?: string) {
    return this.get(osmId).relations.search(key, val);
  }

  /**
   * Plan and apply a merge of two loaded Osm indexes in one call, without review. Replaces the
   * base Osm and deletes the patch Osm.
   */
  async merge(baseOsmId: string, patchOsmId: string, options: MergePlanOptions = {}) {
    const baseOsm = this.get(baseOsmId);
    const patchOsm = this.get(patchOsmId);
    const mergedOsm = await merge(baseOsm, patchOsm, options, this.onProgress);
    this.set(baseOsmId, new Osm(mergedOsm.transferables()));
    this.delete(patchOsmId);
    return mergedOsm.id;
  }

  /**
   * Plan merging a loaded patch into a loaded base, for review. Replaces any plan for this
   * base. Neither dataset changes until {@link applyMergePlan}.
   */
  planMerge(baseOsmId: string, patchOsmId: string, options: MergePlanOptions = {}) {
    const plan = planMerge(this.get(baseOsmId), this.get(patchOsmId), options, this.onProgress);
    this.plans.set(baseOsmId, { patchOsmId, plan, filter: {} });
    return planOverview(plan);
  }

  getMergePlanOverview(baseOsmId: string) {
    return planOverview(this.getPlanSession(baseOsmId).plan);
  }

  /** Set the filter used by subsequent feature page requests. */
  setMergePlanFilter(baseOsmId: string, filter: MergePlanFilter = {}) {
    this.getPlanSession(baseOsmId).filter = { ...filter };
  }

  /** One page of imported features that match the filter, decisions first. */
  getMergePlanPage(baseOsmId: string, page: number, pageSize: number) {
    const session = this.getPlanSession(baseOsmId);
    return planPage(session.plan, this.get(session.patchOsmId), session.filter, page, pageSize);
  }

  /** One feature with the evidence and geometry behind its proposals. */
  getMergePlanFeature(baseOsmId: string, featureKey: string) {
    const session = this.getPlanSession(baseOsmId);
    return planFeatureDetail(
      session.plan,
      this.get(baseOsmId),
      this.get(session.patchOsmId),
      featureKey,
    );
  }

  /** The imported features as GeoJSON, each with its feature key and outcome. */
  getMergePlanLayer(baseOsmId: string) {
    const session = this.getPlanSession(baseOsmId);
    return planLayer(session.plan, this.get(session.patchOsmId));
  }

  /** Replace every decision and replan the phases they affect. */
  setMergePlanDecisions(baseOsmId: string, decisions: PlanDecision[]) {
    const { plan } = this.getPlanSession(baseOsmId);
    setMergePlanDecisions(plan, decisions);
    return planOverview(plan);
  }

  /** Accept, reject, or clear decisions for every proposal the filter matches. */
  applyMergePlanBulk(baseOsmId: string, request: MergePlanBulkRequest): MergePlanBulkResult {
    const { plan } = this.getPlanSession(baseOsmId);
    const { decisions, changed, skipped } = bulkDecisions(plan, request);
    if (changed > 0) setMergePlanDecisions(plan, decisions);
    return { overview: planOverview(plan), changed, skipped };
  }

  /** The plan as an osmChange document. */
  getMergePlanOsc(baseOsmId: string) {
    return generateMergePlanOsc(this.getPlanSession(baseOsmId).plan);
  }

  /**
   * Apply the plan: build the merged dataset once, replace the base with it, and delete the
   * patch. Proposals still waiting for a decision are left out.
   */
  applyMergePlan(baseOsmId: string) {
    const session = this.getPlanSession(baseOsmId);
    const { osm, summary, stats } = applyPlan(session.plan);
    this.plans.delete(baseOsmId);
    this.set(baseOsmId, new Osm(osm.transferables()));
    this.delete(session.patchOsmId);
    return { osmId: baseOsmId, summary, stats };
  }

  clearMergePlan(baseOsmId: string) {
    this.plans.delete(baseOsmId);
  }

  /**
   * Find duplicates inside one dataset (MP-I5). The changes open in the changeset page API and
   * apply with {@link applyChangesAndReplace}.
   */
  planDeduplication(osmId: string) {
    const changeset = planWithinDatasetDeduplication(this.get(osmId), this.onProgress);
    this.changesets.set(osmId, { patchOsmId: osmId, changeset });
    this.filteredChanges.delete(osmId);
    return changeset.stats;
  }

  private getPlanSession(baseOsmId: string) {
    const session = this.plans.get(baseOsmId);
    if (!session) throw Error("No active merge plan");
    return session;
  }

  /**
   * Update filter settings for changeset viewing.
   * Re-sorts all active changesets with the new filters.
   * Skips re-sorting if filters are identical to current settings.
   */
  setChangesetFilters(changeTypes: OsmChangeTypes[], entityTypes: OsmEntityType[]) {
    if (dequal(this.changeTypes, changeTypes) && dequal(this.entityTypes, entityTypes)) {
      return;
    }
    this.changeTypes = changeTypes;
    this.entityTypes = entityTypes;

    // Sort all changesets with new filters
    for (const [osmId, generated] of this.changesets) {
      this.sortChangeset(osmId, generated.changeset);
    }
  }

  /**
   * Retrieve a paginated subset of the filtered changeset.
   * Returns changes for the specified page and the total number of pages.
   */
  getChangesetPage(osmId: string, page: number, pageSize: number) {
    const generated = this.changesets.get(osmId);
    if (!generated) throw Error("No active changeset");
    if (!this.filteredChanges.has(osmId)) this.sortChangeset(osmId, generated.changeset);
    const filteredChanges = this.filteredChanges.get(osmId);
    const changes = filteredChanges?.slice(page * pageSize, (page + 1) * pageSize);
    return {
      changes,
      totalPages: Math.ceil((filteredChanges?.length ?? 0) / pageSize),
    };
  }

  /**
   * Apply a changeset to the base Osm instance, replacing it with the merged result.
   * Deletes the changeset after application.
   */
  applyChangesAndReplace(osmId: string) {
    const generated = this.changesets.get(osmId);
    if (!generated) throw Error("No active changeset");
    const newOsm = applyChangesetToOsm(generated.changeset);
    this.set(osmId, newOsm);
    this.changesets.delete(osmId);
    this.filteredChanges.delete(osmId);
    return newOsm.id;
  }

  /**
   * Filter and sort changeset entries by the current entity type and change type filters.
   * Updates the filteredChanges cache for efficient pagination.
   */
  private sortChangeset(osmId: string, changeset: OsmChangeset) {
    const filteredChanges: OsmChange[] = [];
    if (this.entityTypes.includes("node")) {
      for (const change of Object.values(changeset.nodeChanges)) {
        if (this.changeTypes.includes(change.changeType)) {
          filteredChanges.push(change);
        }
      }
    }
    if (this.entityTypes.includes("way")) {
      for (const change of Object.values(changeset.wayChanges)) {
        if (this.changeTypes.includes(change.changeType)) {
          filteredChanges.push(change);
        }
      }
    }
    if (this.entityTypes.includes("relation")) {
      for (const change of Object.values(changeset.relationChanges)) {
        if (this.changeTypes.includes(change.changeType)) {
          filteredChanges.push(change);
        }
      }
    }
    this.filteredChanges.set(osmId, filteredChanges);
  }
}
