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
  buildConflationBulkDecisionResult,
  discoverConflationCandidates,
  generateChangeset,
  generateConflationApplicationChangeset,
  generateConflationChangeset,
  merge,
  summarizeConflationCandidates,
  type OsmChange,
  type OsmChangeset,
  type OsmChangeTypes,
  type OsmConflationBulkAction,
  type OsmConflationBulkDecisionPreview,
  type OsmConflationBulkDecisionRequest,
  type OsmConflationBulkDecisionResult,
  type OsmConflationCandidate,
  type OsmConflationCandidateFilter,
  type OsmConflationDecision,
  type OsmConflationDiscovery,
  type OsmConflationOptions,
  type OsmConflationSummary,
  type OsmMergeOptions,
  validateConflationDecisions,
} from "@osmix/change";
import { Osm, type OsmOptions, type OsmTransferables } from "@osmix/core";
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
  defaultHighwayFilter,
  defaultPedestrianFilter,
} from "@osmix/router";
import { fromShapefile } from "@osmix/shapefile";
import type { Progress, ProgressEvent } from "@osmix/shared/progress";
import { streamToBytes } from "@osmix/shared/stream-to-bytes";
import type { LonLat, OsmEntityType, Tile } from "@osmix/types";

// Re-export types from router for backwards compatibility
export type { RouteResult, WaySegment };

/** A conflation candidate together with the user's current review decision, if any. */
export interface OsmConflationCandidateView extends OsmConflationCandidate {
  decision?: OsmConflationDecision;
}

/** A stable, paginated view of the active conflation candidates. */
export interface OsmConflationPage {
  bulkActions: Record<OsmConflationBulkAction, OsmConflationBulkDecisionPreview>;
  candidates: OsmConflationCandidateView[];
  page: number;
  pageSize: number;
  totalCandidates: number;
  totalPages: number;
}

/** Routing graph measurements captured before and after fuzzy conflation. */
export interface OsmConflationRoutingGraphStats {
  nodes: number;
  routableNodes: number;
  edges: number;
  components: number;
}

/** Per-mode routing impact of accepted fuzzy conflation candidates. */
export interface OsmConflationRoutingDelta {
  before: OsmConflationRoutingGraphStats;
  after: OsmConflationRoutingGraphStats;
  delta: OsmConflationRoutingGraphStats;
}

/** CAR and WALK topology diagnostics for a generated conflation changeset. */
export interface OsmConflationRoutingDiagnostics {
  car: OsmConflationRoutingDelta;
  walk: OsmConflationRoutingDelta;
}

/** Result of generating the cumulative direct, exact, and fuzzy changeset. */
export interface OsmConflationGenerationResult {
  stats: OsmChangeset["stats"];
  routing: OsmConflationRoutingDiagnostics;
}

interface ConflationSession {
  changesetGenerated: boolean;
  decisions: Map<string, OsmConflationDecision>;
  discovery: OsmConflationDiscovery;
  filter: OsmConflationCandidateFilter;
  patchOsmId: string;
}

// Comlink normally clones return values, but tests and in-process remotes can expose
// direct references. Clone every nested collection so UI code cannot mutate discovery.
function cloneConflationCandidateView(
  candidate: OsmConflationCandidate,
  decision: OsmConflationDecision | undefined,
): OsmConflationCandidateView {
  return {
    ...candidate,
    reasons: [...candidate.reasons],
    propertyTransfer: {
      ...candidate.propertyTransfer,
      reasons: [...candidate.propertyTransfer.reasons],
    },
    networkAttachment: candidate.networkAttachment
      ? {
          ...candidate.networkAttachment,
          reasons: [...candidate.networkAttachment.reasons],
        }
      : null,
    evidence: {
      ...candidate.evidence,
      sourceRoutingFamilies: [...candidate.evidence.sourceRoutingFamilies],
      targetRoutingFamilies: [...candidate.evidence.targetRoutingFamilies],
      tagDiff: candidate.evidence.tagDiff.map((diff) => ({ ...diff })),
      patchWayIds: candidate.evidence.patchWayIds ? [...candidate.evidence.patchWayIds] : undefined,
      endpointDistancesMeters: candidate.evidence.endpointDistancesMeters
        ? [...candidate.evidence.endpointDistancesMeters]
        : undefined,
    },
    decision: decision ? { ...decision } : undefined,
  };
}

function conflationCandidateMatches(
  candidate: OsmConflationCandidate,
  decision: OsmConflationDecision | undefined,
  filter: OsmConflationCandidateFilter,
) {
  const status =
    decision?.action === "accept"
      ? "accepted"
      : decision?.action === "reject"
        ? "rejected"
        : candidate.status;
  if (filter.entityType != null && candidate.entityType !== filter.entityType) return false;
  if (filter.status != null && status !== filter.status) return false;
  if (filter.reason != null && !candidate.reasons.includes(filter.reason)) return false;
  if (filter.sourceId != null && candidate.sourceId !== filter.sourceId) return false;
  if ("targetId" in filter && candidate.targetId !== filter.targetId) return false;
  return true;
}

function routingGraphStats(osm: Osm, filter: HighwayFilter): OsmConflationRoutingGraphStats {
  const graph = new RoutingGraph(osm, filter);
  const parent = new Int32Array(graph.size);
  parent.fill(-1);
  let routableNodes = 0;

  for (let nodeIndex = 0; nodeIndex < graph.size; nodeIndex++) {
    if (!graph.isRoutable(nodeIndex)) continue;
    parent[nodeIndex] = nodeIndex;
    routableNodes++;
  }

  const find = (nodeIndex: number): number => {
    let root = nodeIndex;
    while (parent[root] !== root) root = parent[root]!;
    let cursor = nodeIndex;
    while (parent[cursor] !== cursor) {
      const next = parent[cursor]!;
      parent[cursor] = root;
      cursor = next;
    }
    return root;
  };

  for (let nodeIndex = 0; nodeIndex < graph.size; nodeIndex++) {
    if (parent[nodeIndex] === -1) continue;
    for (const edge of graph.getEdges(nodeIndex)) {
      if (parent[edge.targetNodeIndex] === -1) continue;
      const left = find(nodeIndex);
      const right = find(edge.targetNodeIndex);
      if (left !== right) parent[right] = left;
    }
  }

  const roots = new Set<number>();
  for (let nodeIndex = 0; nodeIndex < graph.size; nodeIndex++) {
    if (parent[nodeIndex] !== -1) roots.add(find(nodeIndex));
  }

  return {
    nodes: graph.size,
    routableNodes,
    edges: graph.edges,
    components: roots.size,
  };
}

function routingDelta(
  before: OsmConflationRoutingGraphStats,
  after: OsmConflationRoutingGraphStats,
): OsmConflationRoutingDelta {
  return {
    before,
    after,
    delta: {
      nodes: after.nodes - before.nodes,
      routableNodes: after.routableNodes - before.routableNodes,
      edges: after.edges - before.edges,
      components: after.components - before.components,
    },
  };
}

function routingDiagnostics(baseline: Osm, conflated: Osm): OsmConflationRoutingDiagnostics {
  const walkFilter: HighwayFilter = (tags) =>
    defaultHighwayFilter(tags) || defaultPedestrianFilter(tags);
  return {
    car: routingDelta(
      routingGraphStats(baseline, defaultHighwayFilter),
      routingGraphStats(conflated, defaultHighwayFilter),
    ),
    walk: routingDelta(
      routingGraphStats(baseline, walkFilter),
      routingGraphStats(conflated, walkFilter),
    ),
  };
}

function carTopologyChanged(diagnostics: OsmConflationRoutingDiagnostics) {
  return (
    diagnostics.car.delta.routableNodes !== 0 ||
    diagnostics.car.delta.edges !== 0 ||
    diagnostics.car.delta.components !== 0
  );
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
  private changesets = new Map<string, OsmChangeset>();
  private conflations = new Map<string, ConflationSession>();
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
    this.invalidateConflationsForDataset(id);
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
    this.invalidateConflationsForDataset(id);
    this.osm.delete(id);
    this.loadDecisions.delete(id);
    this.vtEncoders.delete(id);
    this.graphs.delete(id);
    this.changesets.delete(id);
    this.filteredChanges.delete(id);
  }

  private invalidateConflationsForDataset(osmId: string) {
    for (const [baseOsmId, session] of this.conflations) {
      if (baseOsmId !== osmId && session.patchOsmId !== osmId) continue;
      this.conflations.delete(baseOsmId);
      if (session.changesetGenerated) {
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

  /** Discover non-exact, cross-dataset conflation candidates without mutating either input. */
  discoverConflation(
    baseOsmId: string,
    patchOsmId: string,
    options: OsmConflationOptions,
  ): OsmConflationSummary {
    const discovery = discoverConflationCandidates(
      this.get(baseOsmId),
      this.get(patchOsmId),
      options,
    );
    const initialDecisions = options.decisions === undefined ? [] : options.decisions;
    validateConflationDecisions(discovery.candidates, initialDecisions);
    const decisions = new Map<string, OsmConflationDecision>();
    for (const decision of initialDecisions) {
      decisions.set(decision.candidateId, { ...decision });
    }
    const previous = this.conflations.get(baseOsmId);
    if (previous?.changesetGenerated) {
      this.changesets.delete(baseOsmId);
      this.filteredChanges.delete(baseOsmId);
    }
    this.conflations.set(baseOsmId, {
      changesetGenerated: false,
      decisions,
      discovery,
      filter: {},
      patchOsmId,
    });
    return {
      ...summarizeConflationCandidates(discovery.candidates, [...decisions.values()]),
    };
  }

  /** Return the decision-aware summary for an active conflation session. */
  getConflationSummary(baseOsmId: string): OsmConflationSummary {
    const session = this.getConflationSession(baseOsmId);
    return {
      ...summarizeConflationCandidates(session.discovery.candidates, [
        ...session.decisions.values(),
      ]),
    };
  }

  /** Replace the active candidate filter used by {@link getConflationPage}. */
  setConflationFilter(baseOsmId: string, filter: OsmConflationCandidateFilter = {}) {
    this.getConflationSession(baseOsmId).filter = { ...filter };
  }

  /** Retrieve a stable page of candidates together with their current review decisions. */
  getConflationPage(baseOsmId: string, page: number, pageSize: number): OsmConflationPage {
    if (!Number.isInteger(page) || page < 0) throw Error("page must be a non-negative integer");
    if (!Number.isInteger(pageSize) || pageSize <= 0) {
      throw Error("pageSize must be a positive integer");
    }
    const session = this.getConflationSession(baseOsmId);
    const candidates = session.discovery.candidates.filter((candidate) =>
      conflationCandidateMatches(candidate, session.decisions.get(candidate.id), session.filter),
    );
    const start = page * pageSize;
    const decisions = [...session.decisions.values()];
    const bulkActions = Object.fromEntries(
      (["transfer-properties", "attach-network", "reject"] as const).map((action) => [
        action,
        buildConflationBulkDecisionResult(session.discovery.candidates, decisions, {
          action,
          filter: session.filter,
        }).preview,
      ]),
    ) as Record<OsmConflationBulkAction, OsmConflationBulkDecisionPreview>;
    return {
      bulkActions,
      candidates: candidates
        .slice(start, start + pageSize)
        .map((candidate) =>
          cloneConflationCandidateView(candidate, session.decisions.get(candidate.id)),
        ),
      page,
      pageSize,
      totalCandidates: candidates.length,
      totalPages: Math.ceil(candidates.length / pageSize),
    };
  }

  /** Record or replace one candidate decision and invalidate any generated changeset. */
  setConflationDecision(baseOsmId: string, decision: OsmConflationDecision) {
    const session = this.getConflationSession(baseOsmId);
    // Validate before touching session state so malformed RPC input is atomic.
    validateConflationDecisions(session.discovery.candidates, [decision]);
    this.invalidateGeneratedConflationChangeset(baseOsmId, session);
    session.decisions.set(decision.candidateId, { ...decision });
    return this.getConflationSummary(baseOsmId);
  }

  /** Replace every candidate decision and invalidate any generated changeset. */
  setConflationDecisions(baseOsmId: string, decisions: OsmConflationDecision[]) {
    const session = this.getConflationSession(baseOsmId);
    // Build and validate the replacement set before discarding reviewed output.
    validateConflationDecisions(session.discovery.candidates, decisions);
    const next = new Map<string, OsmConflationDecision>();
    for (const decision of decisions) {
      next.set(decision.candidateId, { ...decision });
    }
    this.invalidateGeneratedConflationChangeset(baseOsmId, session);
    session.decisions = next;
    return this.getConflationSummary(baseOsmId);
  }

  /** Apply one action to every eligible candidate matching the supplied filter. */
  applyConflationBulkDecision(
    baseOsmId: string,
    request: OsmConflationBulkDecisionRequest,
  ): OsmConflationBulkDecisionResult {
    const session = this.getConflationSession(baseOsmId);
    const result = buildConflationBulkDecisionResult(
      session.discovery.candidates,
      [...session.decisions.values()],
      request,
    );
    if (result.preview.changedCandidates > 0) {
      this.invalidateGeneratedConflationChangeset(baseOsmId, session);
      session.decisions = new Map(
        result.decisions.map((decision) => [decision.candidateId, { ...decision }]),
      );
    }
    return {
      decisions: result.decisions.map((decision) => ({ ...decision })),
      preview: { ...result.preview },
      summary: { ...result.summary },
    };
  }

  /**
   * Generate one cumulative direct, exact, and fuzzy changeset from the untouched inputs.
   * Intersections remain a subsequent merge stage so routing diagnostics isolate conflation.
   */
  generateConflationChangeset(
    baseOsmId: string,
    mergeOptions: Partial<OsmMergeOptions> = {},
  ): OsmConflationGenerationResult {
    if (mergeOptions.createIntersections) {
      throw Error(
        "Generate and apply conflation before creating intersections; createIntersections must be false",
      );
    }
    const session = this.getConflationSession(baseOsmId);
    const base = this.get(baseOsmId);
    const patch = this.get(session.patchOsmId);
    const decisions = [...session.decisions.values()];
    const conflation = {
      ...session.discovery.options,
      decisions,
    };
    const options: Partial<OsmMergeOptions> = {
      ...mergeOptions,
      createIntersections: false,
      conflation,
    };
    const changeset = generateConflationChangeset(
      base,
      patch,
      options,
      decisions,
      session.discovery,
    );
    const baselineChangeset = generateChangeset(
      base,
      patch,
      {
        directMerge: mergeOptions.directMerge ?? false,
        deduplicateNodes: mergeOptions.deduplicateNodes ?? false,
        deduplicateWays: mergeOptions.deduplicateWays ?? false,
        createIntersections: false,
      },
      this.onProgress,
    );
    const ordinaryBaseline = applyChangesetToOsm(baselineChangeset);
    const conflated = applyChangesetToOsm(changeset);
    const diagnostics = routingDiagnostics(ordinaryBaseline, conflated);
    // The full result may contain manually reviewed motor-network changes. Project
    // automatic attachments alone so the automatic WALK-only CAR invariant is exact.
    let hasAutomaticNetworkAttachment = false;
    const automaticAttachmentDecisions = session.discovery.candidates.map((candidate) => {
      const decision = session.decisions.get(candidate.id);
      const attachNetwork =
        candidate.networkAttachment?.status === "automatic" &&
        decision?.action !== "reject" &&
        decision?.attachNetwork !== false;
      hasAutomaticNetworkAttachment ||= attachNetwork;
      return {
        candidateId: candidate.id,
        action: attachNetwork ? ("accept" as const) : ("reject" as const),
        transferProperties: false,
        attachNetwork,
      };
    });
    if (hasAutomaticNetworkAttachment) {
      const automaticAttachmentChangeset = generateConflationApplicationChangeset(
        ordinaryBaseline,
        patch,
        session.discovery,
        base,
        automaticAttachmentDecisions,
      );
      const automaticDiagnostics = routingDiagnostics(
        ordinaryBaseline,
        applyChangesetToOsm(automaticAttachmentChangeset),
      );
      if (carTopologyChanged(automaticDiagnostics)) {
        throw Error(
          "Automatic walk-only conflation changed the CAR graph; review the candidate instead",
        );
      }
    }

    this.changesets.set(baseOsmId, changeset);
    this.sortChangeset(baseOsmId, changeset);
    session.changesetGenerated = true;
    return { stats: changeset.stats, routing: diagnostics };
  }

  /** Clear an active conflation session and its generated changeset, if present. */
  clearConflation(baseOsmId: string) {
    const session = this.conflations.get(baseOsmId);
    if (!session) return;
    this.invalidateGeneratedConflationChangeset(baseOsmId, session);
    this.conflations.delete(baseOsmId);
  }

  /**
   * Perform a full merge of two Osm indexes inside of a worker. Both Osm indexes must be loaded already.
   * Replaces the base Osm and deletes the patch Osm.
   */
  async merge(baseOsmId: string, patchOsmId: string, options: Partial<OsmMergeOptions> = {}) {
    const baseOsm = this.get(baseOsmId);
    const patchOsm = this.get(patchOsmId);
    const mergedOsm = await merge(baseOsm, patchOsm, options, this.onProgress);
    this.set(baseOsmId, new Osm(mergedOsm.transferables()));
    this.delete(patchOsmId);
    return mergedOsm.id;
  }

  /**
   * Generate a changeset comparing base and patch Osm instances.
   * Stores the changeset internally and returns stats (counts by change type).
   * Changeset is automatically sorted by the current filter settings.
   */
  async generateChangeset(
    baseOsmId: string,
    patchOsmId: string,
    options: Partial<OsmMergeOptions> = {},
  ) {
    const changeset = generateChangeset(
      this.get(baseOsmId),
      this.get(patchOsmId),
      options,
      this.onProgress,
    );
    this.changesets.set(baseOsmId, changeset);
    this.sortChangeset(baseOsmId, changeset);
    return changeset.stats;
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
    for (const [osmId, changeset] of this.changesets) {
      this.sortChangeset(osmId, changeset);
    }
  }

  /**
   * Retrieve a paginated subset of the filtered changeset.
   * Returns changes for the specified page and the total number of pages.
   */
  getChangesetPage(osmId: string, page: number, pageSize: number) {
    const changeset = this.changesets.get(osmId);
    if (!changeset) throw Error("No active changeset");
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
    const changeset = this.changesets.get(osmId);
    if (!changeset) throw Error("No active changeset");
    const newOsm = applyChangesetToOsm(changeset);
    this.set(osmId, newOsm);
    this.changesets.delete(osmId);
    this.filteredChanges.delete(osmId);
    return newOsm.id;
  }

  private getConflationSession(baseOsmId: string) {
    const session = this.conflations.get(baseOsmId);
    if (!session) throw Error("No active conflation session");
    return session;
  }

  private invalidateGeneratedConflationChangeset(baseOsmId: string, session: ConflationSession) {
    if (!session.changesetGenerated) return;
    // A reviewed changeset is a snapshot of its decisions. Never allow a later
    // decision edit to apply that stale snapshot.
    this.changesets.delete(baseOsmId);
    this.filteredChanges.delete(baseOsmId);
    session.changesetGenerated = false;
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
