import {
  createRemote,
  getOsmixCapabilities,
  type OsmInfo,
  type OsmixRemote,
  type OsmSpatialIndexSelection,
} from "osmix";

import type { OsmixBenchWorker } from "../workers/osmix-bench.worker";
// oxlint-disable-next-line import/default -- Vite ?worker&url resolves to a string URL
import OsmixBenchWorkerUrl from "../workers/osmix-bench.worker.ts?worker&url";
import type {
  BenchEngine,
  EngineInfo,
  LoadPhase,
  LoadResult,
  MemoryReport,
  QueryResult,
  QuerySpec,
} from "./types";

/**
 * Indexes the bench queries need: every node (bbox, nearest), tagged nodes (tiles), and
 * ways. No query reads relations, so their index is skipped, as DuckDB skips them too.
 */
const SPATIAL_INDEXES: OsmSpatialIndexSelection = {
  nodes: ["all", "tagged"],
  ways: true,
  relations: false,
};

/** The load call, shown in the UI next to DuckDB's load SQL. */
export const OSMIX_LOAD_CALL = `await remote.fromPbf(data, {
  spatialIndexes: { nodes: ["all", "tagged"], ways: true, relations: false },
})`;

const PHASE_NAMES: Record<string, string> = {
  parse: "Parse PBF",
  entityIndexes: "Build ID and tag indexes",
  allNodeSpatialIndex: "Build node KD index",
  taggedNodeSpatialIndex: "Build tagged-node KD index",
  waySpatialIndex: "Build way Flatbush index",
};

/** Osmix phase timings, measured inside the worker, plus the remainder the harness saw. */
function loadPhases(info: OsmInfo, totalMs: number): LoadPhase[] {
  const timings = info.loadDiagnostics?.phaseTimingsMs ?? {};
  const phases: LoadPhase[] = [];
  for (const [key, name] of Object.entries(PHASE_NAMES)) {
    const ms = timings[key];
    if (ms !== undefined) phases.push({ name, ms });
  }
  const measured = phases.reduce((sum, phase) => sum + phase.ms, 0);
  phases.push({
    name: "Copy file to worker, share with the pool",
    ms: Math.max(0, totalMs - measured),
  });
  return phases;
}

export class OsmixEngine implements BenchEngine {
  readonly name = "Osmix";
  private readonly remote: OsmixRemote<OsmixBenchWorker>;
  private readonly workerCount: number;
  private osmInfo: OsmInfo | null = null;

  private constructor(remote: OsmixRemote<OsmixBenchWorker>, workerCount: number) {
    this.remote = remote;
    this.workerCount = workerCount;
  }

  /** Start the Osmix worker pool. `workerCount` defaults to Osmix's own choice. */
  static async create(workerCount?: number): Promise<OsmixEngine> {
    const count = workerCount ?? getOsmixCapabilities().maxWorkers;
    const remote = await createRemote<OsmixBenchWorker>({
      workerCount: count,
      workerUrl: new URL(OsmixBenchWorkerUrl, import.meta.url),
    });
    return new OsmixEngine(remote, count);
  }

  info(): EngineInfo {
    return {
      name: "Osmix",
      version: `osmix (workspace), ${this.remote.mode}`,
      threads: this.workerCount,
      notes: [
        this.workerCount === 1
          ? "1 worker."
          : `${this.workerCount} workers sharing one dataset through SharedArrayBuffer.`,
        "Loading runs on one worker; queries run on whichever worker is free.",
        "Results cross postMessage as transferred typed arrays.",
      ],
    };
  }

  private get osmId(): string {
    if (!this.osmInfo) throw Error("Osmix has not loaded a dataset");
    return this.osmInfo.id;
  }

  async load(data: ArrayBuffer): Promise<LoadResult> {
    const start = performance.now();
    const info = await this.remote.fromPbf(data, { spatialIndexes: SPATIAL_INDEXES });
    const totalMs = performance.now() - start;
    this.osmInfo = info;
    if (!info.bbox) throw Error("The dataset has no nodes");
    return {
      bbox: info.bbox,
      phases: loadPhases(info, totalMs),
      counts: {
        nodes: info.stats.nodes,
        ways: info.stats.ways,
        relations: info.stats.relations,
      },
    };
  }

  query(spec: QuerySpec): Promise<QueryResult> {
    const osmId = this.osmId;
    return this.remote.runWithWorker<QueryResult>((worker) => worker.runQuery(osmId, spec));
  }

  explain(): Promise<string | null> {
    return Promise.resolve(null);
  }

  memory(): Promise<MemoryReport> {
    const bytes = this.osmInfo?.loadDiagnostics?.bytes.residentTypedBuffers;
    if (bytes === undefined) throw Error("Osmix load diagnostics are missing");
    return Promise.resolve({ bytes, source: "typed-array buffers of the loaded Osm" });
  }

  async dispose() {
    await this.remote.dispose();
  }
}
