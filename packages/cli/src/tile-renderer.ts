import { inspectBackingBuffers } from "@osmix/shared/backing-buffers";
import { GenerationGate } from "@osmix/shared/generation-gate";
import type { ShortbreadFeatureIndexTransferables } from "@osmix/shortbread";
import type { Remote } from "comlink";
import {
  getOsmixCapabilities,
  type OsmInfo,
  OsmixRemote,
  selectWorkerCount,
  type OsmTransferables,
  type Tile,
} from "osmix";

import type { MapLabelCandidate } from "./map-labels.ts";
import type { TileImage } from "./map-pixels.ts";
import type { SemanticNodeIndexTransferables } from "./semantic-node-index.ts";
import type { SemanticRenderIndexTransferables } from "./semantic-render-index.ts";
import type { MapLabelQueryRequest, MapLabelQueryResult, CliTileWorker } from "./tile-worker.ts";

const MAX_CLI_WORKERS = 4;
const WORKER_RPC_TIMEOUT_MS = 60_000;
const DATASET_LOAD_TIMEOUT_MS = 10 * 60_000;

export type TileRenderingMode = "workers";

export interface BackingBufferDiagnostics {
  allShared: boolean;
  referenceCount: number;
  uniqueCount: number;
}

export interface StyledTileRendererDiagnostics {
  datasetBuffers: BackingBufferDiagnostics;
  restartCount: number;
  semanticIndexBuffers: BackingBufferDiagnostics;
  tileWorkerCount: number;
  totalWorkerCount: number;
}

export interface StyledTileRenderer {
  readonly labelsConcurrent: boolean;
  readonly mode: TileRenderingMode;
  /** Number of workers available for concurrent raster tile jobs. */
  readonly workerCount: number;
  cancelBefore(generation: number): void;
  diagnostics(): StyledTileRendererDiagnostics;
  dispose(): void;
  loadPbfFile(filePath: string, id: string): Promise<OsmInfo>;
  queryLabels(request: MapLabelQueryRequest): Promise<{
    candidates: MapLabelCandidate[];
    revision: number;
  }>;
  renderTile(tile: Tile, generation: number): Promise<TileImage | null>;
}

interface StyledTileRendererOptions {
  onProgress?: (message: string) => void;
}

interface LoadSource {
  filePath: string;
  id: string;
}

function backingBufferDiagnostics(value: unknown): BackingBufferDiagnostics {
  const inspection = inspectBackingBuffers(value);
  return {
    allShared: inspection.unique > 0 && inspection.shared === inspection.unique,
    referenceCount: inspection.references,
    uniqueCount: inspection.unique,
  };
}

export function tileWorkerUrl(moduleUrl: string | URL = import.meta.url): URL {
  const extension = new URL(moduleUrl).pathname.endsWith(".ts") ? "ts" : "js";
  return new URL(`./cli.worker.${extension}`, moduleUrl);
}

/** Reserve one logical core for OpenTUI and cap the worker set at four. */
export function selectTileWorkerCount(hardwareConcurrency: number): number {
  return selectWorkerCount({ hardwareConcurrency, reserveCores: 1, maxWorkers: MAX_CLI_WORKERS });
}

/** CLI-specific state layered on the shared Osmix worker scheduler. */
class CliStyledTileRemote extends OsmixRemote<CliTileWorker> {
  private readonly canShareArrayBuffers: boolean;
  private datasetBuffers: OsmTransferables | null = null;
  private datasetInfo: OsmInfo | null = null;
  private disposed = false;
  private readonly generationGate: GenerationGate;
  private loadSource: LoadSource | null = null;
  private nodeIndexBuffers: SemanticNodeIndexTransferables | null = null;
  private readonly progressReporter: ((message: string) => void) | undefined;
  private renderIndexBuffers: SemanticRenderIndexTransferables | null = null;
  private shortbreadIndexBuffers: ShortbreadFeatureIndexTransferables | null = null;

  constructor(canShareArrayBuffers: boolean, onProgress?: (message: string) => void) {
    super();
    this.canShareArrayBuffers = canShareArrayBuffers;
    this.generationGate = GenerationGate.create({ shared: canShareArrayBuffers });
    this.progressReporter = onProgress;
  }

  get labelsConcurrent(): boolean {
    return this.workerCount > 1;
  }

  get tileWorkerCount(): number {
    if (this.workerCount === 0) return 0;
    return this.workerCount > 1 ? this.workerCount - 1 : 1;
  }

  cancelBefore(generation: number): void {
    if (this.disposed || generation <= this.generationGate.generation) return;
    this.generationGate.update(generation);
    if (this.generationGate.hasSharedState) return;
    this.notifyWorkers((worker) => worker.cancelTilesBefore(generation), this.tileWorkerIndexes());
  }

  styledDiagnostics(): StyledTileRendererDiagnostics {
    this.assertActive();
    const pool = this.workerPoolDiagnostics();
    return {
      datasetBuffers: backingBufferDiagnostics(this.datasetBuffers),
      restartCount: pool.restartCount,
      semanticIndexBuffers: backingBufferDiagnostics([
        this.shortbreadIndexBuffers,
        this.nodeIndexBuffers,
        this.renderIndexBuffers,
      ]),
      tileWorkerCount: this.tileWorkerCount,
      totalWorkerCount: pool.workerCount,
    };
  }

  disposeRenderer(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.terminate();
    this.datasetBuffers = null;
    this.datasetInfo = null;
    this.loadSource = null;
    this.nodeIndexBuffers = null;
    this.renderIndexBuffers = null;
    this.shortbreadIndexBuffers = null;
  }

  async loadPbfFile(filePath: string, id: string): Promise<OsmInfo> {
    this.assertActive();
    this.loadSource = { filePath, id };
    this.datasetBuffers = null;
    this.datasetInfo = null;
    this.nodeIndexBuffers = null;
    this.renderIndexBuffers = null;
    this.shortbreadIndexBuffers = null;

    const info = await this.runWithWorker(
      (worker) => worker.fromPbfFile(filePath, { id, buildSpatialIndexes: ["way", "relation"] }),
      {
        lane: "control",
        retry: "once",
        timeoutMs: DATASET_LOAD_TIMEOUT_MS,
      },
    );
    this.datasetInfo = info;
    if (!this.canShareArrayBuffers) return info;

    this.progressReporter?.("Sharing map indexes with tile workers…");
    await this.runWithWorker(
      async (control) => {
        this.datasetBuffers = await control.getOsmBuffers(info.id);
        this.shortbreadIndexBuffers = await control.getShortbreadFeatureIndexTransferables(info.id);
        this.renderIndexBuffers = await control.getSemanticRenderIndexTransferables(info.id);
        this.nodeIndexBuffers = await control.getSemanticNodeIndexTransferables(info.id);
        await this.populateOtherWorkers(control, info.id);
      },
      { lane: "control", retry: "once", timeoutMs: WORKER_RPC_TIMEOUT_MS },
    );

    if (this.workerCount > 1) {
      const contentHash = this.datasetBuffers!.contentHash;
      await Promise.all(
        this.tileWorkerIndexes().map((index) =>
          this.runOnWorker(
            index,
            async (worker) => {
              await worker.setShortbreadFeatureIndex(
                info.id,
                contentHash,
                this.shortbreadIndexBuffers!,
              );
              await worker.setSemanticNodeIndex(info.id, contentHash, this.nodeIndexBuffers!);
              await worker.setSemanticRenderIndex(info.id, contentHash, this.renderIndexBuffers!);
            },
            { retry: "once", timeoutMs: WORKER_RPC_TIMEOUT_MS },
          ),
        ),
      );
    }
    return info;
  }

  queryLabels(request: MapLabelQueryRequest): Promise<MapLabelQueryResult> {
    this.assertReady();
    return this.runWithWorker(
      (worker) => worker.getMapLabelCandidates(this.datasetInfo!.id, request),
      { lane: "control", retry: "once", timeoutMs: WORKER_RPC_TIMEOUT_MS },
    );
  }

  async renderTile(tile: Tile, generation: number): Promise<TileImage | null> {
    this.assertReady();
    if (this.generationGate.isCancelled(generation)) return null;
    const cancellation = this.generationGate.transferables();
    const data = await this.runWithWorker(
      (worker) => {
        if (this.generationGate.isCancelled(generation)) return null;
        if (!this.generationGate.hasSharedState) {
          return worker.getStyledRasterTileCooperatively(this.datasetInfo!.id, tile, generation);
        }
        return worker.getStyledRasterTile(this.datasetInfo!.id, tile, generation, cancellation);
      },
      { lane: "compute", retry: "once", timeoutMs: WORKER_RPC_TIMEOUT_MS },
    );
    return data ? { data } : null;
  }

  protected override async rehydrateWorker(
    worker: Remote<CliTileWorker>,
    index: number,
  ): Promise<void> {
    if (!this.datasetInfo || !this.loadSource) return;
    this.progressReporter?.(`Restarting map worker ${index + 1}…`);

    if (this.datasetBuffers) {
      if (!(await worker.has(this.datasetInfo.id))) {
        await worker.transferIn(this.datasetBuffers);
      }
      if (this.shortbreadIndexBuffers) {
        await worker.setShortbreadFeatureIndex(
          this.datasetInfo.id,
          this.datasetBuffers.contentHash,
          this.shortbreadIndexBuffers,
        );
      }
      if (this.renderIndexBuffers) {
        await worker.setSemanticRenderIndex(
          this.datasetInfo.id,
          this.datasetBuffers.contentHash,
          this.renderIndexBuffers,
        );
      }
      if (index === 0) {
        await worker.buildSemanticNodeIndex(this.datasetInfo.id);
        await worker.buildSemanticLabelIndex(this.datasetInfo.id);
      } else if (this.nodeIndexBuffers) {
        await worker.setSemanticNodeIndex(
          this.datasetInfo.id,
          this.datasetBuffers.contentHash,
          this.nodeIndexBuffers,
        );
      }
      await worker.cancelTilesBefore(this.generationGate.generation);
      return;
    }

    if (index !== 0) throw Error("Unable to restore a CLI worker without a shared dataset");
    this.progressReporter?.("Reloading the map after a worker restart…");
    this.datasetInfo = await worker.fromPbfFile(this.loadSource.filePath, {
      id: this.loadSource.id,
      buildSpatialIndexes: ["way", "relation"],
    });
    await worker.cancelTilesBefore(this.generationGate.generation);
  }

  private assertActive(): void {
    if (this.disposed) throw Error("Tile renderer disposed");
  }

  private assertReady(): void {
    this.assertActive();
    if (!this.datasetInfo) throw Error("No PBF dataset is loaded");
  }

  private tileWorkerIndexes(): readonly number[] {
    const indexes = this.workerIndexes();
    return indexes.length > 1 ? indexes.slice(1) : indexes;
  }
}

class WorkerBackedStyledTileRenderer implements StyledTileRenderer {
  readonly mode = "workers" as const;
  private readonly remote: CliStyledTileRemote;

  constructor(remote: CliStyledTileRemote) {
    this.remote = remote;
  }

  get workerCount(): number {
    return this.remote.tileWorkerCount;
  }

  get labelsConcurrent(): boolean {
    return this.remote.labelsConcurrent;
  }

  cancelBefore(generation: number): void {
    this.remote.cancelBefore(generation);
  }

  diagnostics(): StyledTileRendererDiagnostics {
    return this.remote.styledDiagnostics();
  }

  dispose(): void {
    this.remote.disposeRenderer();
  }

  loadPbfFile(filePath: string, id: string): Promise<OsmInfo> {
    return this.remote.loadPbfFile(filePath, id);
  }

  queryLabels(request: MapLabelQueryRequest): Promise<MapLabelQueryResult> {
    return this.remote.queryLabels(request);
  }

  renderTile(tile: Tile, generation: number): Promise<TileImage | null> {
    return this.remote.renderTile(tile, generation);
  }
}

/** Create the required off-main-thread CLI worker pool. */
export async function createStyledTileRenderer(
  options: StyledTileRendererOptions = {},
): Promise<StyledTileRenderer> {
  const capabilities = getOsmixCapabilities();
  if (!capabilities.webWorkers) {
    throw Error("The osmix viewer requires Web Worker support for non-blocking rendering.");
  }
  const count = capabilities.canShareArrayBuffers
    ? selectTileWorkerCount(capabilities.hardwareConcurrency)
    : 1;
  const remote = new CliStyledTileRemote(capabilities.canShareArrayBuffers, options.onProgress);
  try {
    // The runtime adapter selects Bun's Web Worker API instead of its Node compatibility layer.
    await remote.initializeWorkerPool(
      count,
      tileWorkerUrl(),
      options.onProgress ? (progress) => options.onProgress?.(progress.msg) : undefined,
      false,
      1,
      capabilities.workerRuntime,
      DATASET_LOAD_TIMEOUT_MS,
    );
    return new WorkerBackedStyledTileRenderer(remote);
  } catch (error) {
    remote.disposeRenderer();
    throw error;
  }
}
