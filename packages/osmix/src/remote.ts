/**
 * Worker-based remote API for OSM operations.
 *
 * OsmixRemote manages a pool of browser or Node workers and provides a high-level API
 * for loading, querying, and manipulating OSM data off the main thread.
 * Uses SharedArrayBuffer for efficient multi-worker data sharing when available.
 *
 * @module
 */

import type {
  OsmChangeTypes,
  OsmConflationBulkDecisionRequest,
  OsmConflationCandidateFilter,
  OsmConflationDecision,
  OsmConflationOptions,
  OsmMergeOptions,
} from "@osmix/change";
import { Osm, type OsmInfo, type OsmOptions, type OsmTransferables } from "@osmix/core";
import type { GeoParquetReadOptions } from "@osmix/geoparquet";
import { type GtfsConversionOptions, isGtfsZip as isGtfsZipBytes } from "@osmix/gtfs";
import { type OsmFromPbfOptions, type OsmLoadDecision, toPbfStream } from "@osmix/load";
import type {
  DefaultSpeeds,
  HighwayFilter,
  RouteOptions,
  RouteResult,
  RoutingGraphTransferables,
} from "@osmix/router";
import { inspectBackingBuffers, isSharedArrayBuffer } from "@osmix/shared/backing-buffers";
import type { Progress } from "@osmix/shared/progress";
import { streamToBytes } from "@osmix/shared/stream-to-bytes";
import type { LonLat, OsmEntityType, Tile } from "@osmix/types";
import * as Comlink from "comlink";

import {
  canShareArrayBuffers,
  getOsmixCapabilities,
  type OsmixMode,
  type WorkerRuntime,
} from "./capabilities.ts";
import { installStructuredComlinkErrorTransferHandler } from "./comlink-errors.ts";
import type { DrawToRasterTileOptions } from "./raster.ts";
import { supportsReadableStreamTransfer, transfer } from "./utils.ts";
import {
  createOsmixWorkerConnection,
  createOsmixWorkerPool,
  defaultOsmixWorkerUrl,
  type OsmixWorkerPool,
  type OsmixWorkerPoolDiagnostics,
} from "./worker-pool.ts";
import { OsmixWorker } from "./worker.ts";

installStructuredComlinkErrorTransferHandler();

/** Identifier for an OSM dataset: string ID, Osm instance, or OsmInfo object. */
export type OsmId = string | Osm | OsmInfo;

/** Supported file types for OSM data loading. */
export type OsmFileType = "pbf" | "geojson" | "shapefile" | "geoparquet" | "gtfs";

/** All supported file types for display/selection purposes. */
export const OSM_FILE_TYPES: OsmFileType[] = ["pbf", "geojson", "shapefile", "geoparquet", "gtfs"];

/**
 * Detect file type from filename extension.
 * Returns "pbf" as default for unknown extensions.
 */
export function detectFileType(fileName: string): OsmFileType {
  const lowerName = fileName.toLowerCase();
  if (lowerName.endsWith(".geojson") || lowerName.endsWith(".json")) {
    return "geojson";
  }
  if (lowerName.endsWith(".zip")) {
    return "shapefile";
  }
  if (lowerName.endsWith(".parquet")) {
    return "geoparquet";
  }
  return "pbf";
}

type DatasetMember = "nodes" | "ways" | "relations";

type BoundDatasetMethod<F> = F extends (osmId: OsmId, ...args: infer Args) => infer Return
  ? (...args: Args) => Return
  : never;

type DatasetProxyMethodName =
  | "get"
  | "getLoadDecision"
  | "has"
  | "isReady"
  | "search"
  | "getVectorTile"
  | "getRasterTile"
  | "toPbfData"
  | "toPbf"
  | "transferOut"
  | "delete"
  | "buildRoutingGraph"
  | "hasRoutingGraph"
  | "findNearestRoutableNode"
  | "route"
  | "generateChangeset"
  | "applyChangesAndReplace"
  | "setChangesetFilters"
  | "getChangesetPage";

type ConflationDatasetProxyMethodName =
  | "applyConflationBulkDecision"
  | "discoverConflation"
  | "getConflationSummary"
  | "setConflationFilter"
  | "getConflationPage"
  | "setConflationDecision"
  | "setConflationDecisions"
  | "generateConflationChangeset"
  | "clearConflation";

type OsmRemoteDatasetMethods<T extends OsmixWorker> = {
  [K in DatasetProxyMethodName | ConflationDatasetProxyMethodName]: BoundDatasetMethod<
    OsmixRemote<T>[K]
  >;
};

type DatasetMemberMethodName = "size" | "getById" | "search";

type MemberRemoteMethodName<
  M extends DatasetMember,
  K extends DatasetMemberMethodName,
> = `${M}${Capitalize<K>}`;

type OsmRemoteDatasetMemberMethods<T extends OsmixWorker, M extends DatasetMember> = {
  [K in DatasetMemberMethodName]: BoundDatasetMethod<OsmixRemote<T>[MemberRemoteMethodName<M, K>]>;
};

/**
 * Object-oriented handle for a remote Osm dataset.
 *
 * Includes `OsmInfo` fields (`id`, `bbox`, `header`, `stats`) plus convenience
 * methods so callers do not need to pass IDs repeatedly.
 *
 * Method forwarding is proxied from `OsmixRemote` at runtime. Any public
 * `OsmixRemote` method with signature `(osmId, ...args)` is exposed here,
 * with `osmId` automatically bound to this dataset's `id`.
 */
class OsmRemoteDatasetBase<T extends OsmixWorker = OsmixWorker> implements OsmInfo {
  readonly remote: OsmixRemote<T>;
  id: string;
  readonly bbox: OsmInfo["bbox"];
  readonly header: OsmInfo["header"];
  readonly stats: OsmInfo["stats"];
  readonly spatialIndexes: OsmInfo["spatialIndexes"];
  readonly loadDiagnostics: OsmInfo["loadDiagnostics"];
  readonly nodes: OsmRemoteDatasetMemberMethods<T, "nodes">;
  readonly ways: OsmRemoteDatasetMemberMethods<T, "ways">;
  readonly relations: OsmRemoteDatasetMemberMethods<T, "relations">;

  constructor(remote: OsmixRemote<T>, id: string, info: Omit<OsmInfo, "id">) {
    this.remote = remote;
    this.id = id;
    this.bbox = info.bbox;
    this.header = info.header;
    this.stats = info.stats;
    this.spatialIndexes = info.spatialIndexes;
    this.loadDiagnostics = info.loadDiagnostics;
    this.nodes = this.createMemberProxy("nodes");
    this.ways = this.createMemberProxy("ways");
    this.relations = this.createMemberProxy("relations");
  }

  private createMemberProxy<M extends DatasetMember>(
    member: M,
  ): OsmRemoteDatasetMemberMethods<T, M> {
    return new Proxy({} as OsmRemoteDatasetMemberMethods<T, M>, {
      get: (_target, prop) => {
        if (typeof prop !== "string") return undefined;
        const method = `${member}${prop.charAt(0).toUpperCase()}${prop.slice(1)}`;
        const remoteValue = Reflect.get(this.remote, method);
        if (typeof remoteValue !== "function") return undefined;
        return (...args: unknown[]) => remoteValue.call(this.remote, this.id, ...args);
      },
    });
  }

  async rename(toId: string) {
    await this.remote.rename(this.id, toId);
    this.id = toId;
  }

  merge(patch: OsmId, options: Partial<OsmMergeOptions> = {}) {
    return this.remote.merge(this, patch, options);
  }
}

export type OsmRemoteDataset<T extends OsmixWorker = OsmixWorker> = OsmRemoteDatasetBase<T> &
  OsmRemoteDatasetMethods<T>;

function createOsmRemoteDataset<T extends OsmixWorker = OsmixWorker>(
  remote: OsmixRemote<T>,
  id: string,
  info: Omit<OsmInfo, "id">,
): OsmRemoteDataset<T> {
  const base = new OsmRemoteDatasetBase<T>(remote, id, info);
  return new Proxy(base, {
    get: (target, prop, receiver) => {
      const value = Reflect.get(target, prop, receiver);
      if (value !== undefined) return value;
      if (typeof prop !== "string") return value;

      const remoteValue = Reflect.get(target.remote, prop);
      if (typeof remoteValue !== "function") return remoteValue;
      return (...args: unknown[]) => remoteValue.call(target.remote, target.id, ...args);
    },
  }) as OsmRemoteDataset<T>;
}
export interface OsmixRemoteOptions {
  /**
   * Number of workers to create. Defaults to `getOsmixCapabilities().maxWorkers`:
   * the hardware concurrency when `SharedArrayBuffer`s can be shared across
   * threads (cross-origin isolated browsers, Node), otherwise 1.
   */
  workerCount?: number;
  onProgress?: (progress: Progress) => void;
  /**
   * Custom worker URL for extended OsmixWorker implementations.
   * When provided, workers will be created from this URL instead of the default.
   *
   * @example
   * // Use a custom worker with extended functionality
   * const remote = await createRemote({
   *   workerUrl: new URL("./my-custom.worker.ts", import.meta.url)
   * })
   */
  workerUrl?: URL;
  /** Override automatic browser/Bun/Deno Web Worker or Node worker-thread selection. */
  workerRuntime?: WorkerRuntime | "auto";
  /**
   * Run the `OsmixWorker` on the calling thread instead of spawning a
   * Worker. The API is identical but nothing runs in parallel and long
   * operations will block the current thread. This is the supported path for
   * worker. This is useful for tests and explicitly blocking workflows.
   */
  inProcess?: boolean;
  /** Maximum times a failed worker slot is recreated. Defaults to one. */
  restartAttempts?: number;
  /** Maximum time to rehydrate a replacement worker. Defaults to 10 seconds. */
  restoreTimeoutMs?: number;
}

/** Worker lane used by {@link OsmixRemote.runWithWorker}. */
export type OsmixWorkerLane = "any" | "compute" | "control";

/** Scheduling controls for a managed custom-worker operation. */
export interface OsmixRunWithWorkerOptions {
  /** Cancel a queued operation. Running work must still cooperate to stop early. */
  signal?: AbortSignal;
  /** Prefer control worker zero, compute workers, or any available worker. */
  lane?: OsmixWorkerLane;
  /** Higher values run before lower-priority queued work; equal priorities stay FIFO. */
  priority?: number;
  /** Retry once after a successful worker restart and rehydration. Defaults to never. */
  retry?: "never" | "once";
  /** Reject and restart a worker when this operation exceeds the supplied duration. */
  timeoutMs?: number;
}

/** A known worker dataset could not be reconstructed after its worker restarted. */
export class OsmixDatasetLossError extends Error {
  readonly datasetIds: readonly string[];
  readonly workerIndex: number;
  override readonly cause: unknown;

  constructor(datasetIds: readonly string[], workerIndex: number, cause?: unknown) {
    super(
      `Worker ${workerIndex} restarted without a replayable source for dataset${
        datasetIds.length === 1 ? "" : "s"
      }: ${datasetIds.join(", ")}`,
      { cause },
    );
    this.name = "OsmixDatasetLossError";
    this.datasetIds = [...datasetIds];
    this.workerIndex = workerIndex;
    this.cause = cause;
  }
}

/** A broadcast state change may have left worker slots with divergent state. */
export class OsmixRemoteStateError extends Error {
  readonly operation: string;
  override readonly cause: unknown;

  constructor(operation: string, cause: unknown) {
    super(`The Osmix worker pool is unusable after a partial ${operation}`, { cause });
    this.name = "OsmixRemoteStateError";
    this.operation = operation;
    this.cause = cause;
  }
}

/**
 * Create a new `OsmixRemote` instance and initialize its worker pool.
 * Each worker receives the same progress listener proxy if provided.
 *
 * Mode selection (see `getOsmixCapabilities()` and `remote.mode`):
 * - Cross-origin isolated browsers, Bun, Deno, and Node get shared multi-worker datasets
 *   via `SharedArrayBuffer`.
 * - Browsers without `SharedArrayBuffer` sharing get a single worker.
 * - Environments without a worker implementation throw; pass `inProcess: true` to run on
 *   the calling thread instead.
 *
 * @example
 * // Default usage
 * const remote = await createRemote()
 * console.log(remote.mode) // "multi-worker" | "single-worker"
 *
 * @example
 * // With custom worker for extended functionality
 * const remote = await createRemote({
 *   workerUrl: new URL("./shortbread.worker.ts", import.meta.url)
 * })
 */
export async function createRemote<T extends OsmixWorker = OsmixWorker>({
  workerCount,
  onProgress,
  workerUrl,
  workerRuntime = "auto",
  inProcess = false,
  restartAttempts = 1,
  restoreTimeoutMs,
}: OsmixRemoteOptions = {}): Promise<OsmixRemote<T>> {
  const remote = new OsmixRemote<T>();
  const count = workerCount ?? (inProcess ? 1 : getOsmixCapabilities().maxWorkers);
  await remote.initializeWorkerPool(
    count,
    workerUrl,
    onProgress,
    inProcess,
    restartAttempts,
    workerRuntime,
    restoreTimeoutMs,
  );
  return remote;
}

/**
 * Resolve the URL of the default worker entry relative to this module.
 * Matches the extension of the running module so it works both from
 * TypeScript source (monorepo dev) and from the built `dist` output
 * (published package in Node, CDNs, and unbundled ESM).
 */
export function defaultWorkerUrl(): URL {
  return defaultOsmixWorkerUrl(import.meta.url);
}

type WorkerCleanup = () => void;

const workerCleanup = new WeakMap<object, WorkerCleanup>();

function hasOnlySharedBackingBuffers(value: unknown): boolean {
  const inspection = inspectBackingBuffers(value);
  return inspection.unique > 0 && inspection.arrayBuffers === 0;
}

/**
 * Create a single `OsmixWorker` instance wrapped with Comlink.
 * Spawns a browser, Bun, or Deno Worker or a Node worker thread and returns a proxy.
 *
 * @param workerUrl - Optional URL to a custom worker file. If not provided,
 *                    uses the default `OsmixWorker`.
 *
 * @example
 * // Default worker
 * const worker = await createOsmixWorker()
 *
 * @example
 * // Custom worker
 * const worker = await createOsmixWorker<MyCustomWorker>(
 *   new URL("./my-custom.worker.ts", import.meta.url)
 * )
 */
export async function createOsmixWorker<T extends OsmixWorker = OsmixWorker>(
  workerUrl?: URL,
): Promise<Comlink.Remote<T>> {
  const connection = await createOsmixWorkerConnection<T>({
    workerUrl: workerUrl ?? defaultWorkerUrl(),
  });
  workerCleanup.set(connection.remote, () => connection.terminate());
  return connection.remote;
}

/**
 * Manage Osm instances access across one or more workers. Coordinates work distribution and synchronizes
 * data across multiple workers using `SharedArrayBuffer`s.
 *
 * The generic type parameter T allows typing custom worker implementations:
 * @example
 * class MyWorker extends OsmixWorker {
 *   myMethod(id: string) { ... }
 * }
 * const remote = await createRemote<MyWorker>({
 *   workerUrl: new URL("./my.worker.ts", import.meta.url)
 * })
 * // remote.getWorker() returns Comlink.Remote<MyWorker>
 */
interface ActiveChangesetState {
  baseOsmId: string;
  changeTypes: OsmChangeTypes[];
  entityTypes: OsmEntityType[];
  options: Partial<OsmMergeOptions>;
  patchOsmId: string;
}

interface ActiveConflationState {
  baseOsmId: string;
  changeTypes: OsmChangeTypes[];
  changesetGenerated: boolean;
  decisions: OsmConflationDecision[];
  entityTypes: OsmEntityType[];
  filter: OsmConflationCandidateFilter;
  mergeOptions: Partial<OsmMergeOptions>;
  options: OsmConflationOptions;
  patchOsmId: string;
}

type DatasetRestorer<T extends OsmixWorker> = (
  worker: Comlink.Remote<T>,
  datasetId: string,
) => Promise<unknown>;

export class OsmixRemote<T extends OsmixWorker = OsmixWorker> {
  private activeChangeset: ActiveChangesetState | null = null;
  private readonly activeConflations = new Map<string, ActiveConflationState>();
  private readonly datasetRestorers = new Map<string, DatasetRestorer<T> | null>();
  private readonly retainedDatasets = new Map<string, OsmTransferables>();
  private readonly retainedLoadDecisions = new Map<string, OsmLoadDecision | null>();
  private readonly retainedRoutingGraphs = new Map<string, RoutingGraphTransferables>();
  private onProgress: ((progress: Progress) => void) | undefined;
  private disposal: Promise<void> | null = null;
  private poolMode: OsmixMode | null = null;
  private terminalError: OsmixRemoteStateError | null = null;
  private workerPool: OsmixWorkerPool<T> | null = null;

  /**
   * How this remote runs its workload: `multi-worker`, `single-worker`, or
   * `in-process`. Set by `initializeWorkerPool`.
   */
  get mode(): OsmixMode {
    if (!this.poolMode) throw Error("Worker pool not initialized");
    return this.poolMode;
  }

  /** Number of workers in the pool. */
  get workerCount(): number {
    return this.workerPool?.workerCount ?? 0;
  }

  /**
   * Initialize workers.
   * - Use a custom worker by passing a worker URL.
   * - Pass a progress listener to receive updates during long-running operations.
   * - Multiple workers require `SharedArrayBuffer` sharing (see `getOsmixCapabilities()`).
   * - Pass `inProcess: true` to run a single `OsmixWorker` on the calling thread.
   */
  async initializeWorkerPool(
    workerCount: number,
    workerUrl?: URL,
    onProgress?: (progress: Progress) => void,
    inProcess = false,
    restartAttempts = 1,
    workerRuntime: WorkerRuntime | "auto" = "auto",
    restoreTimeoutMs?: number,
  ) {
    if (this.disposal) await this.disposal;
    if (workerCount < 1) throw Error("Worker count must be at least 1");
    if (workerCount > 1 && inProcess)
      throw Error("In-process mode runs on the calling thread and supports only one worker.");
    if (workerUrl && inProcess)
      throw Error("Custom worker URLs cannot be used in in-process mode.");
    if (workerCount > 1 && !canShareArrayBuffers())
      throw Error(
        "Multiple workers require SharedArrayBuffer sharing, which needs a cross-origin " +
          "isolated context. Serve your app with COOP/COEP headers " +
          "(Cross-Origin-Opener-Policy: same-origin, Cross-Origin-Embedder-Policy: require-corp) " +
          "or omit workerCount. See https://github.com/conveyal/osmix/tree/main/packages/osmix#enabling-multi-worker-mode",
      );
    this.onProgress = onProgress;
    this.terminalError = null;
    try {
      this.workerPool = await createOsmixWorkerPool<T>({
        createInProcessWorker: () => new OsmixWorker() as T,
        inProcess,
        restartAttempts,
        restoreTimeoutMs,
        runtime: workerRuntime,
        restoreWorker: (worker, index, attempt) => this.restorePoolWorker(worker, index, attempt),
        workerCount,
        workerUrl: inProcess ? undefined : (workerUrl ?? defaultWorkerUrl()),
      });
      if (onProgress) {
        await this.workerPool.broadcast((worker) =>
          worker.addProgressListener(Comlink.proxy(onProgress)),
        );
      }
    } catch (error) {
      this.terminate();
      throw error;
    }
    this.poolMode = inProcess ? "in-process" : workerCount > 1 ? "multi-worker" : "single-worker";
  }

  /**
   * Run a custom operation on a managed worker. The worker remains leased until
   * the returned promise settles, allowing the pool to dispatch by availability.
   */
  runWithWorker<R>(
    task: (worker: Comlink.Remote<T>, index: number) => R | Promise<R>,
    options: OsmixRunWithWorkerOptions = {},
  ): Promise<R> {
    if (this.terminalError) return Promise.reject(this.terminalError);
    const pool = this.getPool();
    const { lane = "any", ...runOptions } = options;
    const allIndexes = pool.workerIndexes;
    const eligibleWorkerIndexes =
      lane === "control"
        ? [allIndexes[0]!]
        : lane === "compute" && allIndexes.length > 1
          ? allIndexes.slice(1)
          : allIndexes;
    return pool.run(task, { ...runOptions, eligibleWorkerIndexes });
  }

  /** Run an operation on every worker while respecting existing leases. */
  protected broadcastToWorkers<R>(
    task: (worker: Comlink.Remote<T>, index: number) => R | Promise<R>,
    options: Omit<OsmixRunWithWorkerOptions, "lane"> = {},
  ): Promise<R[]> {
    return this.getPool().broadcast(task, options);
  }

  /**
   * Broadcast state that must agree across every selected worker. A final
   * failure is terminal because the caller cannot know which slots committed.
   */
  protected async broadcastStateChange<R>(
    operation: string,
    task: (worker: Comlink.Remote<T>, index: number) => R | Promise<R>,
    options: {
      eligibleWorkerIndexes?: readonly number[];
      retry?: "never" | "once";
    } = {},
  ): Promise<R[]> {
    const pool = this.getPool();
    try {
      return await pool.broadcast(task, options);
    } catch (cause) {
      const error = new OsmixRemoteStateError(operation, cause);
      this.terminalError = error;
      void pool.dispose();
      throw error;
    }
  }

  /** Run an operation on one stable worker index while respecting its lease. */
  protected runOnWorker<R>(
    index: number,
    task: (worker: Comlink.Remote<T>, index: number) => R | Promise<R>,
    options: Omit<OsmixRunWithWorkerOptions, "lane"> = {},
  ): Promise<R> {
    return this.getPool().runOn(index, task, options);
  }

  /** Inspect the managed pool without exposing raw worker proxies. */
  protected workerPoolDiagnostics(): OsmixWorkerPoolDiagnostics {
    return this.getPool().diagnostics();
  }

  /** Stable worker indexes for subclass lane and broadcast policies. */
  protected workerIndexes(): readonly number[] {
    return this.getPool().workerIndexes;
  }

  /**
   * Send an out-of-band cooperative signal without acquiring worker leases.
   * This is intentionally limited to idempotent notifications such as generation
   * cancellation that must be observed by an async RPC already running in a slot.
   */
  protected notifyWorkers(
    task: (worker: Comlink.Remote<T>, index: number) => void | Promise<void>,
    workerIndexes: readonly number[] = this.workerIndexes(),
  ): void {
    const pool = this.getPool();
    for (const index of workerIndexes) {
      try {
        void Promise.resolve(task(pool.getUnmanagedWorker(index), index)).catch(() => undefined);
      } catch {
        // Notifications are best-effort; managed work surfaces slot failures.
      }
    }
  }

  /**
   * Get an unmanaged worker proxy for backwards compatibility.
   * @deprecated Use {@link runWithWorker} so busy workers, cancellation, and
   * recovery are tracked by the pool.
   *
   * @example
   * class ShortbreadWorker extends OsmixWorker {
   *   getShortbreadVectorTile(id: string, tile: Tile) { ... }
   * }
   * const remote = await createRemote<ShortbreadWorker>({
   *   workerUrl: new URL("./shortbread.worker.ts", import.meta.url)
   * })
   * const tile = await remote.getWorker().getShortbreadVectorTile(osmId, tile)
   */
  getWorker(): Comlink.Remote<T> {
    return this.getPool().getUnmanagedWorker();
  }

  /** Restore application-specific state after base datasets and graphs are present. */
  protected async rehydrateWorker(
    _worker: Comlink.Remote<T>,
    _index: number,
    _restartAttempt: number,
  ): Promise<void> {}

  /**
   * Restore a known dataset from an application-owned replayable source.
   *
   * Subclasses can use this for sources such as IndexedDB or a filesystem path
   * without retaining a second copy of the dataset bytes in `OsmixRemote`.
   * Return `true` after installing `datasetId` in `worker`; the base class still
   * verifies that the dataset exists before making the slot available.
   */
  protected async recoverDataset(
    _worker: Comlink.Remote<T>,
    _datasetId: string,
    _workerIndex: number,
    _restartAttempt: number,
  ): Promise<boolean> {
    return false;
  }

  /** Mark an application-loaded dataset as known so restart recovery is verified. */
  protected registerDatasetForRecovery(osmId: OsmId): void {
    const id = this.getId(osmId);
    if (!this.datasetRestorers.has(id)) this.datasetRestorers.set(id, null);
  }

  /** Forget application-owned recovery metadata when a dataset is intentionally removed. */
  protected unregisterDatasetForRecovery(osmId: OsmId): void {
    const id = this.getId(osmId);
    this.datasetRestorers.delete(id);
    this.retainedDatasets.delete(id);
    this.retainedLoadDecisions.delete(id);
    this.retainedRoutingGraphs.delete(id);
  }

  private invalidateConflationsForDataset(osmId: OsmId): void {
    const id = this.getId(osmId);
    // Dataset IDs are logical keys and loaders may replace the contents under one.
    // Candidate evidence and decisions are invalid as soon as either input changes.
    for (const [baseOsmId, state] of this.activeConflations) {
      if (baseOsmId === id || state.patchOsmId === id) {
        this.activeConflations.delete(baseOsmId);
      }
    }
    if (
      this.activeChangeset &&
      (this.activeChangeset.baseOsmId === id || this.activeChangeset.patchOsmId === id)
    ) {
      this.activeChangeset = null;
    }
  }

  private getActiveConflation(baseOsmId: string): ActiveConflationState {
    const state = this.activeConflations.get(baseOsmId);
    if (!state) throw Error("No active conflation session");
    return state;
  }

  /** Mark changed data as known but not reproducible from its original source. */
  private markDatasetUnrecoverable(osmId: OsmId): void {
    const id = this.getId(osmId);
    this.datasetRestorers.set(id, null);
    this.retainedDatasets.delete(id);
    this.retainedLoadDecisions.delete(id);
    this.retainedRoutingGraphs.delete(id);
  }

  private getPool(): OsmixWorkerPool<T> {
    if (this.terminalError) throw this.terminalError;
    if (!this.workerPool) throw Error("No worker available");
    return this.workerPool;
  }

  protected async restorePoolWorker(
    worker: Comlink.Remote<T>,
    index: number,
    restartAttempt: number,
  ): Promise<void> {
    if (this.onProgress) {
      await worker.addProgressListener(Comlink.proxy(this.onProgress));
    }
    for (const [id, transferables] of this.retainedDatasets) {
      await worker.transferIn(transferables, this.retainedLoadDecisions.get(id) ?? null);
    }

    const recoveryFailures = new Map<string, unknown>();
    for (const [datasetId, restorer] of this.datasetRestorers) {
      if (await worker.has(datasetId)) continue;
      if (restorer) {
        try {
          await restorer(worker, datasetId);
        } catch (error) {
          recoveryFailures.set(datasetId, error);
        }
      }
      if (await worker.has(datasetId)) continue;
      try {
        await this.recoverDataset(worker, datasetId, index, restartAttempt);
      } catch (error) {
        recoveryFailures.set(datasetId, error);
      }
    }

    try {
      await this.rehydrateWorker(worker, index, restartAttempt);
    } catch (error) {
      const missing = await this.findMissingDatasets(worker);
      if (missing.length > 0) {
        throw new OsmixDatasetLossError(missing, index, error);
      }
      throw error;
    }

    const missing = await this.findMissingDatasets(worker);
    if (missing.length > 0) {
      const cause = missing.map((id) => recoveryFailures.get(id)).find(Boolean);
      throw new OsmixDatasetLossError(missing, index, cause);
    }

    for (const [osmId, transferables] of this.retainedRoutingGraphs) {
      await worker.transferRoutingGraphIn(osmId, transferables);
    }
    if (index === 0 && this.activeChangeset) {
      const state = this.activeChangeset;
      await worker.generateChangeset(state.baseOsmId, state.patchOsmId, state.options);
      await worker.setChangesetFilters(state.changeTypes, state.entityTypes);
    }
    if (index === 0) {
      for (const state of this.activeConflations.values()) {
        // Recovery reproduces review state by rediscovering from restored untouched
        // inputs, then replaying stable ID-based decisions and filters.
        await worker.discoverConflation(state.baseOsmId, state.patchOsmId, state.options);
        await worker.setConflationFilter(state.baseOsmId, state.filter);
        await worker.setConflationDecisions(state.baseOsmId, state.decisions);
        if (state.changesetGenerated) {
          await worker.generateConflationChangeset(state.baseOsmId, state.mergeOptions);
          await worker.setChangesetFilters(state.changeTypes, state.entityTypes);
        }
      }
    }
  }

  private async findMissingDatasets(worker: Comlink.Remote<T>): Promise<string[]> {
    const missing: string[] = [];
    for (const datasetId of this.datasetRestorers.keys()) {
      if (!(await worker.has(datasetId))) missing.push(datasetId);
    }
    return missing;
  }

  /**
   * Convert various input types into a transferable format suitable for posting to workers.
   * Falls back to converting streams to buffers if stream transfer is unsupported.
   */
  private isReplayableFile(value: unknown): value is File {
    return typeof File !== "undefined" && value instanceof File;
  }

  private async getTransferableData(data: ArrayBufferLike | ReadableStream | Uint8Array | File) {
    if (data instanceof ArrayBuffer) return data;
    if (isSharedArrayBuffer(data)) return data;
    if (data instanceof Uint8Array) {
      if (data.byteOffset === 0 && data.byteLength === data.buffer.byteLength) {
        return data.buffer;
      }
      return new Uint8Array(data).buffer;
    }
    if (data instanceof ReadableStream) {
      if (supportsReadableStreamTransfer()) return data;
      return (await streamToBytes(data)).buffer;
    }
    if (this.isReplayableFile(data)) {
      if (supportsReadableStreamTransfer()) return data.stream();
      return data.arrayBuffer();
    }
    throw Error("Invalid data");
  }

  /**
   * Synchronize an `Osm` instance from one worker to all others using SharedArrayBuffer.
   * No-op if SharedArrayBuffer is unsupported (single-worker mode).
   */
  protected async populateOtherWorkers(worker: Comlink.Remote<OsmixWorker>, osmId: OsmId) {
    const pool = this.getPool();
    this.registerDatasetForRecovery(osmId);
    if (pool.workerCount <= 1 && !canShareArrayBuffers()) return;
    const transferables = await worker.getOsmBuffers(this.getId(osmId));
    const loadDecision = await worker.getLoadDecision(this.getId(osmId));
    const isShared = hasOnlySharedBackingBuffers(transferables);
    if (pool.workerCount > 1 && !isShared) {
      throw Error("Multiple workers require a SharedArrayBuffer-backed OSM dataset");
    }
    if (isShared) {
      this.retainedDatasets.set(transferables.id, transferables);
      this.retainedLoadDecisions.set(transferables.id, loadDecision);
      // Shared descriptors are the recovery source. Do not also retain a File
      // or URL that may reference the complete regional input.
      this.datasetRestorers.set(transferables.id, null);
    }
    if (pool.workerCount <= 1) return;
    await this.broadcastStateChange(
      "dataset replication",
      (target) => target.transferIn(transferables, loadDecision),
      {
        eligibleWorkerIndexes: pool.workerIndexes.slice(1),
        retry: "once",
      },
    );
  }

  /** Replicate a control-worker dataset and retain its shared descriptors for recovery. */
  protected async populateDatasetFromControl(osmId: OsmId): Promise<void> {
    await this.runWithWorker((worker) => this.populateOtherWorkers(worker, osmId), {
      lane: "control",
      retry: "once",
    });
  }

  private wrap(info: OsmInfo): OsmRemoteDataset<T> {
    const { id, ...rest } = info;
    return createOsmRemoteDataset(this, id, rest);
  }

  /**
   * Load an `Osm` instance from PBF data in a worker.
   * Data is sent to the first available worker, then synchronized across all workers.
   */
  async fromPbf(
    data: ArrayBufferLike | ReadableStream | Uint8Array | File,
    options: Partial<OsmFromPbfOptions> = {},
  ) {
    const transferableData = await this.getTransferableData(data);
    const osmInfo = await this.runWithWorker(
      (worker) => worker.fromPbf(transfer({ data: transferableData, options })),
      { lane: "control", retry: "never" },
    );
    this.invalidateConflationsForDataset(osmInfo.id);
    const replayOptions = { ...options };
    this.datasetRestorers.set(
      osmInfo.id,
      this.isReplayableFile(data)
        ? async (worker, datasetId) => {
            const replayData = await this.getTransferableData(data);
            return worker.fromPbf(
              transfer({ data: replayData, options: { ...replayOptions, id: datasetId } }),
            );
          }
        : null,
    );
    await this.populateDatasetFromControl(osmInfo.id);
    return this.wrap(osmInfo);
  }

  /**
   * Serialize an `Osm` instance to PBF and pipe into the provided writable stream.
   * Requires browser support for transferable streams.
   */
  toPbfStream(osmId: OsmId, writeableStream: WritableStream<Uint8Array>) {
    if (!supportsReadableStreamTransfer()) throw Error("Stream transfer not supported");
    return this.runWithWorker(
      (worker) =>
        worker.toPbfStream(
          Comlink.transfer({ osmId: this.getId(osmId), writeableStream }, [writeableStream]),
        ),
      { lane: "any", retry: "never" },
    );
  }

  /**
   * Serialize an `Osm` instance to a single PBF buffer.
   * Returns the buffer transferred from the worker.
   */
  toPbfData(osmId: OsmId) {
    return this.runWithWorker((worker) => worker.toPbf(this.getId(osmId)), {
      retry: "once",
    });
  }

  /**
   * Serialize an `Osm` instance to PBF and write to the provided stream.
   * Automatically selects worker-based streaming or fallback based on browser support.
   */
  async toPbf(osmId: OsmId, stream: WritableStream<Uint8Array>) {
    if (supportsReadableStreamTransfer()) return this.toPbfStream(osmId, stream);
    const osm = await this.get(osmId);
    return toPbfStream(osm).pipeTo(stream);
  }

  /**
   * Load an `Osm` instance from GeoJSON data in a worker.
   * Data is sent to the first available worker, then synchronized across all workers.
   */
  async fromGeoJSON(
    data: ArrayBufferLike | ReadableStream | Uint8Array | File,
    options: Partial<OsmOptions> = {},
  ) {
    const transferableData = await this.getTransferableData(data);
    const osmInfo = await this.runWithWorker(
      (worker) =>
        worker.fromGeoJSON(
          transfer({
            data: transferableData,
            options,
          }),
        ),
      { lane: "control", retry: "never" },
    );
    this.invalidateConflationsForDataset(osmInfo.id);
    const replayOptions = { ...options };
    this.datasetRestorers.set(
      osmInfo.id,
      this.isReplayableFile(data)
        ? async (worker, datasetId) => {
            const replayData = await this.getTransferableData(data);
            return worker.fromGeoJSON(
              transfer({ data: replayData, options: { ...replayOptions, id: datasetId } }),
            );
          }
        : null,
    );
    await this.populateDatasetFromControl(osmInfo.id);
    return this.wrap(osmInfo);
  }

  /**
   * Load an `Osm` instance from Shapefile (ZIP) data in a worker.
   * Data is sent to the first available worker, then synchronized across all workers.
   */
  async fromShapefile(
    data: ArrayBufferLike | ReadableStream | Uint8Array | File,
    options: Partial<OsmOptions> = {},
  ) {
    const transferableData = await this.getTransferableData(data);
    const osmInfo = await this.runWithWorker(
      (worker) =>
        worker.fromShapefile(
          transfer({
            data: transferableData,
            options,
          }),
        ),
      { lane: "control", retry: "never" },
    );
    this.invalidateConflationsForDataset(osmInfo.id);
    const replayOptions = { ...options };
    this.datasetRestorers.set(
      osmInfo.id,
      this.isReplayableFile(data)
        ? async (worker, datasetId) => {
            const replayData = await this.getTransferableData(data);
            return worker.fromShapefile(
              transfer({ data: replayData, options: { ...replayOptions, id: datasetId } }),
            );
          }
        : null,
    );
    await this.populateDatasetFromControl(osmInfo.id);
    return this.wrap(osmInfo);
  }

  /**
   * Load an `Osm` instance from GTFS (ZIP) data in a worker.
   * Data is sent to the first available worker, then synchronized across all workers.
   */
  async fromGtfs(
    data: ArrayBufferLike | ReadableStream | Uint8Array | File,
    options: Partial<OsmOptions> = {},
    gtfsOptions: GtfsConversionOptions = {},
  ) {
    const transferableData = await this.getTransferableData(data);
    const osmInfo = await this.runWithWorker(
      (worker) =>
        worker.fromGtfs(
          transfer({
            data: transferableData,
            options,
            gtfsOptions,
          }),
        ),
      { lane: "control", retry: "never" },
    );
    this.invalidateConflationsForDataset(osmInfo.id);
    const replayOptions = { ...options };
    const replayGtfsOptions = { ...gtfsOptions };
    this.datasetRestorers.set(
      osmInfo.id,
      this.isReplayableFile(data)
        ? async (worker, datasetId) => {
            const replayData = await this.getTransferableData(data);
            return worker.fromGtfs(
              transfer({
                data: replayData,
                options: { ...replayOptions, id: datasetId },
                gtfsOptions: replayGtfsOptions,
              }),
            );
          }
        : null,
    );
    await this.populateDatasetFromControl(osmInfo.id);
    return this.wrap(osmInfo);
  }

  /**
   * Load an `Osm` instance from a File.
   * If fileType is provided, uses that format directly.
   * Otherwise auto-detects format by extension:
   * - .geojson and .json files are loaded as GeoJSON
   * - .zip files are inspected to determine if they are GTFS or Shapefile
   * - .parquet files are loaded as GeoParquet
   * - All others are loaded as PBF
   */
  async fromFile(file: File, options: Partial<OsmFromPbfOptions> = {}, fileType?: OsmFileType) {
    if (fileType) {
      // Use provided file type directly
      switch (fileType) {
        case "geojson":
          return this.fromGeoJSON(file, {
            ...options,
            id: options.id ?? file.name,
          });
        case "shapefile":
          return this.fromShapefile(file, {
            ...options,
            id: options.id ?? file.name,
          });
        case "geoparquet":
          return this.fromGeoParquet(file, {
            ...options,
            id: options.id ?? file.name,
          });
        case "gtfs":
          return this.fromGtfs(file, {
            ...options,
            id: options.id ?? file.name,
          });
        default:
          return this.fromPbf(file, {
            ...options,
            id: options.id ?? file.name,
          });
      }
    }

    // Auto-detect file type
    const fileName = file.name.toLowerCase();
    const isGeoJSON = fileName.endsWith(".geojson") || fileName.endsWith(".json");
    const isZip = fileName.endsWith(".zip");
    const isParquet = fileName.endsWith(".parquet");

    if (isGeoJSON) {
      return this.fromGeoJSON(file, { ...options, id: options.id ?? file.name });
    }
    if (isZip) {
      // Peek into the zip to determine if it's GTFS or Shapefile
      const isGtfs = await this.isGtfsZip(file);
      if (isGtfs) {
        return this.fromGtfs(file, { ...options, id: options.id ?? file.name });
      }
      return this.fromShapefile(file, {
        ...options,
        id: options.id ?? file.name,
      });
    }
    if (isParquet) {
      return this.fromGeoParquet(file, {
        ...options,
        id: options.id ?? file.name,
      });
    }
    return this.fromPbf(file, { ...options, id: options.id ?? file.name });
  }

  /**
   * Check if a ZIP file is a GTFS archive by looking for characteristic GTFS files.
   * GTFS archives must contain at least agency.txt, stops.txt, routes.txt, trips.txt,
   * and stop_times.txt according to the GTFS specification.
   */
  private async isGtfsZip(file: File): Promise<boolean> {
    try {
      const buffer = await file.arrayBuffer();
      const bytes = new Uint8Array(buffer);
      return isGtfsZipBytes(bytes);
    } catch {
      return false;
    }
  }

  /**
   * Load an `Osm` instance from GeoParquet data in a worker.
   * Data is sent to the first available worker, then synchronized across all workers.
   */
  async fromGeoParquet(
    data: ArrayBuffer | File | string | URL,
    options: Partial<OsmOptions> = {},
    readOptions: GeoParquetReadOptions = {},
  ) {
    const transferableData = await this.getGeoParquetTransferableData(data);
    const osmInfo = await this.runWithWorker(
      (worker) =>
        worker.fromGeoParquet(
          transfer({
            data: transferableData,
            options,
            readOptions,
          }),
        ),
      { lane: "control", retry: "never" },
    );
    this.invalidateConflationsForDataset(osmInfo.id);
    const replayOptions = { ...options };
    const replayReadOptions = { ...readOptions };
    const replayableSource =
      typeof data === "string"
        ? data
        : data instanceof URL
          ? new URL(data.href)
          : this.isReplayableFile(data)
            ? data
            : null;
    this.datasetRestorers.set(
      osmInfo.id,
      replayableSource
        ? async (worker, datasetId) => {
            const replayData = await this.getGeoParquetTransferableData(replayableSource);
            return worker.fromGeoParquet(
              transfer({
                data: replayData,
                options: { ...replayOptions, id: datasetId },
                readOptions: replayReadOptions,
              }),
            );
          }
        : null,
    );
    await this.populateDatasetFromControl(osmInfo.id);
    return this.wrap(osmInfo);
  }

  /**
   * Convert GeoParquet input data to a transferable format.
   * Strings and URLs are passed through; Files are converted to ArrayBuffer.
   */
  private async getGeoParquetTransferableData(
    data: ArrayBuffer | File | string | URL,
  ): Promise<ArrayBuffer | string | URL> {
    if (typeof data === "string") return data;
    if (data instanceof URL) return data;
    if (data instanceof ArrayBuffer) return data;
    if (this.isReplayableFile(data)) return data.arrayBuffer();
    throw Error("Invalid GeoParquet data source");
  }

  /**
   * Read only the header from PBF data without loading entities.
   * Useful for previewing metadata before committing to a full load.
   */
  async readHeader(data: ArrayBuffer | ReadableStream | Uint8Array | File) {
    const transferableData = await this.getTransferableData(data);
    return this.runWithWorker((worker) => worker.readHeader(transferableData), {
      retry: "never",
    });
  }

  /**
   * Extract the string ID from an OsmId union type.
   * Accepts a string ID, an `Osm` instance, or an `OsmInfo` object.
   */
  getId(osmId: OsmId) {
    if (typeof osmId === "string") {
      return osmId;
    }
    return osmId.id;
  }

  /**
   * Check if an Osm instance has completed index building and is ready for queries.
   */
  async isReady(osmId: OsmId) {
    if (this.terminalError) throw this.terminalError;
    try {
      await this.getPool().broadcast(
        async (worker) => {
          const isReady = await worker.isReady(this.getId(osmId));
          if (!isReady) throw Error("Osm instance is not ready");
        },
        { retry: "once" },
      );
    } catch (error) {
      if (error instanceof OsmixRemoteStateError) throw error;
      return false;
    }
    return true;
  }

  /**
   * Check if an `Osm` instance exists in any worker.
   */
  has(osmId: OsmId) {
    return this.runWithWorker((worker) => worker.has(this.getId(osmId)), { retry: "once" });
  }

  /** Return the load-profile decision recorded for a PBF dataset. */
  getLoadDecision(osmId: OsmId) {
    return this.runWithWorker((worker) => worker.getLoadDecision(this.getId(osmId)), {
      retry: "once",
    });
  }

  /**
   * Retrieve an `Osm` instance from a worker and reconstruct it on the main thread.
   * Useful for direct access when worker overhead is unnecessary.
   */
  async get(osmId: OsmId): Promise<Osm> {
    const transferables = await this.runWithWorker(
      (worker) => worker.getOsmBuffers(this.getId(osmId)),
      { retry: "once" },
    );
    return new Osm(transferables);
  }

  /**
   * Transfer an `Osm` instance from workers back to the main thread and remove it from workers.
   * Useful for final cleanup or moving data out of worker context.
   */
  async transferOut(osmId: OsmId): Promise<Osm> {
    const transferables = await this.runWithWorker(
      (worker) => worker.transferOut(this.getId(osmId)),
      { lane: "control", retry: "never" },
    );
    await this.delete(osmId);
    return new Osm(transferables);
  }

  /**
   * Transfer an `Osm` instance from the main thread into all workers.
   * Distributes data across the worker pool for parallel operations.
   */
  async transferIn(osm: Osm): Promise<void> {
    const transferables = osm.transferables();
    const isShared = hasOnlySharedBackingBuffers(transferables);
    if (this.workerCount > 1 && !isShared) {
      throw Error("Multiple workers require a SharedArrayBuffer-backed OSM dataset");
    }
    this.invalidateConflationsForDataset(transferables.id);
    this.markDatasetUnrecoverable(transferables.id);
    if (isShared) {
      this.retainedDatasets.set(transferables.id, transferables);
      this.retainedLoadDecisions.set(transferables.id, null);
    }
    await this.broadcastStateChange("dataset transfer", (worker) =>
      worker.transferIn(transfer(transferables)),
    );
  }

  /**
   * Remove an `Osm` instance from all workers, freeing its memory.
   */
  async delete(osmId: OsmId): Promise<void> {
    const id = this.getId(osmId);
    this.invalidateConflationsForDataset(id);
    this.unregisterDatasetForRecovery(id);
    if (
      this.activeChangeset &&
      (this.activeChangeset.baseOsmId === id || this.activeChangeset.patchOsmId === id)
    ) {
      this.activeChangeset = null;
    }
    await this.broadcastStateChange("dataset deletion", (worker) => worker.delete(id));
  }

  /**
   * Rename an `Osm` instance from one ID to another in all workers.
   * Useful when the content hash changes and you need to update the worker key
   * to match a new storage key.
   */
  async rename(fromId: OsmId, toId: string): Promise<void> {
    const from = this.getId(fromId);
    if (from === toId) return;
    // Get the osm from one worker, then re-register under the new ID
    const { loadDecision, transferables } = await this.runWithWorker(
      async (worker) => ({
        loadDecision: await worker.getLoadDecision(from),
        transferables: await worker.getOsmBuffers(from),
      }),
      { lane: "control", retry: "once" },
    );
    // Invalidate sessions using either key: rename removes the source and may
    // overwrite a different dataset already registered at the destination.
    this.invalidateConflationsForDataset(from);
    this.invalidateConflationsForDataset(toId);
    // Update the id in the transferables
    const updatedTransferables = { ...transferables, id: toId };
    const restorer = this.datasetRestorers.get(from) ?? null;
    this.unregisterDatasetForRecovery(from);
    this.unregisterDatasetForRecovery(toId);
    this.datasetRestorers.set(toId, restorer);
    if (hasOnlySharedBackingBuffers(updatedTransferables)) {
      this.retainedDatasets.set(toId, updatedTransferables);
      this.retainedLoadDecisions.set(toId, loadDecision);
    }
    // Delete old entries and transfer in with new ID
    await this.broadcastStateChange("dataset rename", async (worker) => {
      await worker.delete(from);
      await worker.transferIn(updatedTransferables, loadDecision);
    });
  }

  /**
   * Generate a Mapbox Vector Tile for the specified tile coordinates.
   * Delegates to an available worker for off-thread rendering.
   */
  getVectorTile(osmId: OsmId, tile: Tile) {
    return this.runWithWorker((worker) => worker.getVectorTile(this.getId(osmId), tile), {
      retry: "once",
    });
  }

  /**
   * Generate a raster tile as ImageData for the specified tile coordinates.
   * Delegates to an available worker for off-thread rendering.
   */
  getRasterTile(osmId: OsmId, tile: Tile, opts?: DrawToRasterTileOptions) {
    return this.runWithWorker((worker) => worker.getRasterTile(this.getId(osmId), tile, opts), {
      retry: "once",
    });
  }

  /**
   * Search for `Osm` entities by tag key and optional value.
   * Delegates to an available worker for off-thread search.
   */
  search(osmId: OsmId, key: string, val?: string) {
    return this.runWithWorker((worker) => worker.search(this.getId(osmId), key, val), {
      retry: "once",
    });
  }

  nodesSize(osmId: OsmId) {
    return this.runWithWorker((worker) => worker.nodesSize(this.getId(osmId)), {
      retry: "once",
    });
  }

  nodesGetById(osmId: OsmId, nodeId: number) {
    return this.runWithWorker((worker) => worker.nodesGetById(this.getId(osmId), nodeId), {
      retry: "once",
    });
  }

  nodesSearch(osmId: OsmId, key: string, val?: string) {
    return this.runWithWorker((worker) => worker.nodesSearch(this.getId(osmId), key, val), {
      retry: "once",
    });
  }

  waysSize(osmId: OsmId) {
    return this.runWithWorker((worker) => worker.waysSize(this.getId(osmId)), {
      retry: "once",
    });
  }

  waysGetById(osmId: OsmId, wayId: number) {
    return this.runWithWorker((worker) => worker.waysGetById(this.getId(osmId), wayId), {
      retry: "once",
    });
  }

  waysSearch(osmId: OsmId, key: string, val?: string) {
    return this.runWithWorker((worker) => worker.waysSearch(this.getId(osmId), key, val), {
      retry: "once",
    });
  }

  relationsSize(osmId: OsmId) {
    return this.runWithWorker((worker) => worker.relationsSize(this.getId(osmId)), {
      retry: "once",
    });
  }

  relationsGetById(osmId: OsmId, relationId: number) {
    return this.runWithWorker((worker) => worker.relationsGetById(this.getId(osmId), relationId), {
      retry: "once",
    });
  }

  relationsSearch(osmId: OsmId, key: string, val?: string) {
    return this.runWithWorker((worker) => worker.relationsSearch(this.getId(osmId), key, val), {
      retry: "once",
    });
  }

  // ---------------------------------------------------------------------------
  // Routing
  // ---------------------------------------------------------------------------

  /**
   * Synchronize a routing graph from one worker to all others using SharedArrayBuffer.
   * No-op if SharedArrayBuffer is unsupported (single-worker mode).
   */
  private async populateRoutingGraphToOtherWorkers(
    worker: Comlink.Remote<OsmixWorker>,
    osmId: OsmId,
  ) {
    const pool = this.getPool();
    if (pool.workerCount <= 1 && !canShareArrayBuffers()) return;
    const transferables = await worker.getRoutingGraphTransferables(this.getId(osmId));
    const isShared = hasOnlySharedBackingBuffers(transferables);
    if (pool.workerCount > 1 && !isShared) {
      throw Error("Multiple workers require a SharedArrayBuffer-backed routing graph");
    }
    if (isShared) this.retainedRoutingGraphs.set(this.getId(osmId), transferables);
    if (pool.workerCount <= 1) return;
    await this.broadcastStateChange(
      "routing graph replication",
      (target) => target.transferRoutingGraphIn(this.getId(osmId), transferables),
      { eligibleWorkerIndexes: pool.workerIndexes.slice(1), retry: "once" },
    );
  }

  /**
   * Build a routing graph for an Osm instance in a worker.
   * Graph is built in the first available worker, then synchronized across all workers.
   *
   * @param osmId - ID of the Osm instance to build a graph for.
   * @param filter - Optional filter function to determine which ways are routable.
   * @param defaultSpeeds - Optional speed limits by highway type.
   * @returns Graph statistics (node and edge counts).
   */
  async buildRoutingGraph(osmId: OsmId, filter?: HighwayFilter, defaultSpeeds?: DefaultSpeeds) {
    return this.runWithWorker(
      async (worker) => {
        const stats = await worker.buildRoutingGraph(this.getId(osmId), filter, defaultSpeeds);
        await this.populateRoutingGraphToOtherWorkers(worker, osmId);
        return stats;
      },
      { lane: "control", retry: "once" },
    );
  }

  /**
   * Check if a routing graph exists for an Osm instance.
   */
  hasRoutingGraph(osmId: OsmId) {
    return this.runWithWorker((worker) => worker.hasRoutingGraph(this.getId(osmId)), {
      retry: "once",
    });
  }

  /**
   * Find the nearest routable node to a geographic point.
   * Delegates to an available worker for off-thread computation.
   *
   * @param osmId - ID of the Osm instance.
   * @param point - [lon, lat] coordinates to search from.
   * @param maxDistanceM - Maximum search radius in meters.
   * @returns Nearest routable node info, or null if none found.
   */
  findNearestRoutableNode(osmId: OsmId, point: LonLat, maxDistanceM: number) {
    return this.runWithWorker(
      (worker) => worker.findNearestRoutableNode(this.getId(osmId), point, maxDistanceM),
      { retry: "once" },
    );
  }

  /**
   * Calculate a route between two node indexes.
   * Delegates to an available worker for off-thread pathfinding.
   *
   * @param osmId - ID of the Osm instance.
   * @param fromIndex - Starting node index.
   * @param toIndex - Destination node index.
   * @param options - Optional routing options (algorithm, metric).
   * @returns Route result with coordinates and way info, or null if no route found.
   */
  route(
    osmId: OsmId,
    fromIndex: number,
    toIndex: number,
    options?: Partial<RouteOptions>,
  ): Promise<RouteResult | null> {
    return this.runWithWorker(
      (worker) => worker.route(this.getId(osmId), fromIndex, toIndex, options),
      { retry: "once" },
    );
  }

  // ---------------------------------------------------------------------------
  // Merge & Changesets
  // ---------------------------------------------------------------------------

  /** Discover fuzzy cross-dataset candidates without changing either input dataset. */
  async discoverConflation(baseOsmId: OsmId, patchOsmId: OsmId, options: OsmConflationOptions) {
    const baseId = this.getId(baseOsmId);
    const patchId = this.getId(patchOsmId);
    // Recovery state must not share mutable decisions or option arrays with callers.
    const storedOptions = structuredClone(options);
    const result = await this.runWithWorker(
      (worker) => worker.discoverConflation(baseId, patchId, storedOptions),
      { lane: "control", retry: "never" },
    );
    this.activeConflations.set(baseId, {
      baseOsmId: baseId,
      changeTypes: ["create", "modify", "delete"],
      changesetGenerated: false,
      decisions: storedOptions.decisions ?? [],
      entityTypes: ["node", "way", "relation"],
      filter: {},
      mergeOptions: {},
      options: storedOptions,
      patchOsmId: patchId,
    });
    return result;
  }

  /** Return the current, decision-aware candidate summary. */
  getConflationSummary(baseOsmId: OsmId) {
    return this.runWithWorker((worker) => worker.getConflationSummary(this.getId(baseOsmId)), {
      lane: "control",
      retry: "once",
    });
  }

  /** Set the filter used by subsequent candidate page requests. */
  async setConflationFilter(baseOsmId: OsmId, filter: OsmConflationCandidateFilter = {}) {
    const baseId = this.getId(baseOsmId);
    const state = this.getActiveConflation(baseId);
    const storedFilter = structuredClone(filter);
    await this.runWithWorker((worker) => worker.setConflationFilter(baseId, storedFilter), {
      lane: "control",
      retry: "never",
    });
    state.filter = storedFilter;
  }

  /** Retrieve one page of filtered candidates and their current decisions. */
  getConflationPage(baseOsmId: OsmId, page: number, pageSize: number) {
    return this.runWithWorker(
      (worker) => worker.getConflationPage(this.getId(baseOsmId), page, pageSize),
      { lane: "control", retry: "once" },
    );
  }

  /** Record or replace a single candidate decision. */
  async setConflationDecision(baseOsmId: OsmId, decision: OsmConflationDecision) {
    const baseId = this.getId(baseOsmId);
    const state = this.getActiveConflation(baseId);
    const storedDecision = structuredClone(decision);
    const result = await this.runWithWorker(
      (worker) => worker.setConflationDecision(baseId, storedDecision),
      { lane: "control", retry: "never" },
    );
    state.decisions = [
      ...state.decisions.filter((existing) => existing.candidateId !== storedDecision.candidateId),
      storedDecision,
    ];
    state.changesetGenerated = false;
    state.mergeOptions = {};
    return result;
  }

  /** Replace all candidate decisions for the active session. */
  async setConflationDecisions(baseOsmId: OsmId, decisions: OsmConflationDecision[]) {
    const baseId = this.getId(baseOsmId);
    const state = this.getActiveConflation(baseId);
    const storedDecisions = structuredClone(decisions);
    const result = await this.runWithWorker(
      (worker) => worker.setConflationDecisions(baseId, storedDecisions),
      { lane: "control", retry: "never" },
    );
    state.decisions = storedDecisions;
    state.changesetGenerated = false;
    state.mergeOptions = {};
    return result;
  }

  /** Apply one action to all eligible candidates matching a filter across every page. */
  async applyConflationBulkDecision(baseOsmId: OsmId, request: OsmConflationBulkDecisionRequest) {
    const baseId = this.getId(baseOsmId);
    const state = this.getActiveConflation(baseId);
    const storedRequest = structuredClone(request);
    const result = await this.runWithWorker(
      (worker) => worker.applyConflationBulkDecision(baseId, storedRequest),
      { lane: "control", retry: "never" },
    );
    state.decisions = result.decisions.map((decision) => ({ ...decision }));
    if (result.preview.changedCandidates > 0) {
      state.changesetGenerated = false;
      state.mergeOptions = {};
    }
    return {
      decisions: result.decisions.map((decision) => ({ ...decision })),
      preview: { ...result.preview },
      summary: { ...result.summary },
    };
  }

  /**
   * Generate the cumulative direct, exact, and accepted fuzzy changeset.
   * Inputs remain untouched until {@link applyChangesAndReplace} is called.
   */
  async generateConflationChangeset(baseOsmId: OsmId, mergeOptions: Partial<OsmMergeOptions> = {}) {
    const baseId = this.getId(baseOsmId);
    const state = this.getActiveConflation(baseId);
    const storedOptions = { ...mergeOptions, conflation: undefined };
    const result = await this.runWithWorker(
      (worker) => worker.generateConflationChangeset(baseId, storedOptions),
      { lane: "control", retry: "never" },
    );
    state.changesetGenerated = true;
    state.mergeOptions = storedOptions;
    this.activeChangeset = null;
    return result;
  }

  /** Cancel a conflation session and discard any generated changeset. */
  async clearConflation(baseOsmId: OsmId) {
    const baseId = this.getId(baseOsmId);
    await this.runWithWorker((worker) => worker.clearConflation(baseId), {
      lane: "control",
      retry: "never",
    });
    this.activeConflations.delete(baseId);
  }

  /**
   * Merge two `Osm` instances in a worker.
   * Replaces the base instance with the merge result and deletes the patch instance.
   * Synchronizes the merged result across all workers.
   */
  async merge(baseOsmId: OsmId, patchOsmId: OsmId, options: Partial<OsmMergeOptions> = {}) {
    const osmId = await this.runWithWorker(
      (worker) => worker.merge(this.getId(baseOsmId), this.getId(patchOsmId), options),
      { lane: "control", retry: "never" },
    );
    this.invalidateConflationsForDataset(baseOsmId);
    this.invalidateConflationsForDataset(patchOsmId);
    this.markDatasetUnrecoverable(osmId);
    await this.populateDatasetFromControl(osmId);
    await this.delete(patchOsmId);
    const merged = await this.get(osmId);
    return this.wrap(merged.info());
  }

  /**
   * Generate a changeset comparing base and patch `Osm` instances in the changeset worker.
   * Returns statistics about the changeset (create/modify/delete counts).
   */
  async generateChangeset(
    baseOsmId: OsmId,
    patchOsmId: OsmId,
    options: Partial<OsmMergeOptions> = {},
  ) {
    const result = await this.runWithWorker(
      (worker) => worker.generateChangeset(this.getId(baseOsmId), this.getId(patchOsmId), options),
      { lane: "control", retry: "never" },
    );
    this.activeChangeset = {
      baseOsmId: this.getId(baseOsmId),
      changeTypes: ["create", "modify", "delete"],
      entityTypes: ["node", "way", "relation"],
      options,
      patchOsmId: this.getId(patchOsmId),
    };
    return result;
  }

  /**
   * Apply the active changeset to its base `Osm` instance and replace it with the result.
   * Synchronizes the updated instance across all workers.
   */
  async applyChangesAndReplace(osmId: OsmId) {
    await this.runWithWorker((worker) => worker.applyChangesAndReplace(this.getId(osmId)), {
      lane: "control",
      retry: "never",
    });
    this.invalidateConflationsForDataset(osmId);
    this.markDatasetUnrecoverable(osmId);
    await this.populateDatasetFromControl(osmId);
    this.activeChangeset = null;
  }

  /**
   * Update filter settings for changeset viewing in the changeset worker.
   * Filters control which change types and entity types are visible when paginating.
   */
  setChangesetFilters(changeTypes: OsmChangeTypes[], entityTypes: OsmEntityType[]) {
    if (this.activeChangeset) {
      this.activeChangeset.changeTypes = [...changeTypes];
      this.activeChangeset.entityTypes = [...entityTypes];
    }
    for (const state of this.activeConflations.values()) {
      if (!state.changesetGenerated) continue;
      state.changeTypes = [...changeTypes];
      state.entityTypes = [...entityTypes];
    }
    void this.runWithWorker((worker) => worker.setChangesetFilters(changeTypes, entityTypes), {
      lane: "control",
      retry: "never",
    });
  }

  /**
   * Retrieve a paginated subset of the filtered changeset from the changeset worker.
   */
  getChangesetPage(osmId: OsmId, page: number, pageSize: number) {
    return this.runWithWorker(
      (worker) => worker.getChangesetPage(this.getId(osmId), page, pageSize),
      { lane: "control", retry: "once" },
    );
  }

  /**
   * Terminate all workers, await their shutdown, and release their resources.
   */
  dispose(): Promise<void> {
    if (this.disposal) return this.disposal;
    const pool = this.workerPool;
    this.workerPool = null;
    this.activeChangeset = null;
    this.activeConflations.clear();
    this.datasetRestorers.clear();
    this.retainedDatasets.clear();
    this.retainedLoadDecisions.clear();
    this.retainedRoutingGraphs.clear();
    this.poolMode = null;
    this.terminalError = null;
    this.disposal = (async () => {
      try {
        await pool?.dispose();
      } finally {
        this.disposal = null;
      }
    })();
    return this.disposal;
  }

  /** Start worker shutdown without waiting. Prefer {@link dispose} when shutdown ordering matters. */
  terminate(): void {
    void this.dispose();
  }

  [Symbol.dispose]() {
    this.terminate();
  }

  [Symbol.asyncDispose](): Promise<void> {
    return this.dispose();
  }
}
