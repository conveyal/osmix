/**
 * Runs both engines through setup and every operation.
 *
 * Setup (Initialize, Load) runs once per engine: it is expensive and a cold number is the
 * one users see. Each query runs once cold, is checked for equal answers, then gets
 * `warmups` untimed runs and `runs` timed runs per engine. Engine order alternates between
 * iterations so neither engine always runs on a warmer JIT, cache, or CPU clock.
 */

import { DuckDBEngine } from "../engines/duckdb-engine";
import { OsmixEngine } from "../engines/osmix-engine";
import type {
  BenchEngine,
  EngineInfo,
  EngineName,
  LoadResult,
  MemoryReport,
  QueryResult,
} from "../engines/types";
import { buildOperations, type Operation } from "../operations";
import { compareResults, type Parity } from "./compare";
import { summarize, type TimingStats } from "./stats";

export const ENGINE_NAMES: EngineName[] = ["Osmix", "DuckDB"];

/** Larger GeoJSON exports are not kept for the maps; drawing them stalls the page. */
export const MAP_GEOJSON_LIMIT = 25_000_000;

export interface BenchConfig {
  file: File;
  /** Osmix worker count. Omit to let Osmix choose. */
  osmixWorkers?: number;
  warmups?: number;
  runs?: number;
  onProgress?: (message: string) => void;
}

export interface EngineTiming extends TimingStats {
  cold: number;
}

export interface OperationResult {
  operation: Operation;
  /** Missing when an engine failed to answer. */
  parity?: Parity;
  /** Which engine failed and why. */
  error?: string;
  /** Missing when the answers did not match or an engine failed. */
  timings?: Record<EngineName, EngineTiming>;
  /** DuckDB's plan operators for this query. */
  duckdbPlan: string | null;
}

export interface SetupResult {
  initializeMs: number;
  loadMs: number;
  load: LoadResult;
  memory: MemoryReport;
  info: EngineInfo;
}

export interface BenchReport {
  file: { name: string; bytes: number };
  environment: { crossOriginIsolated: boolean; hardwareConcurrency: number; userAgent: string };
  config: { warmups: number; runs: number };
  setup: Record<EngineName, SetupResult>;
  operations: OperationResult[];
  /** Each engine's GeoJSON export, for the maps, when under `MAP_GEOJSON_LIMIT`. */
  geojson: Record<EngineName, string> | null;
}

async function timed<T>(run: () => Promise<T>): Promise<[T, number]> {
  const start = performance.now();
  const value = await run();
  return [value, performance.now() - start];
}

function engineOrder(iteration: number) {
  return iteration % 2 === 0 ? ENGINE_NAMES : [...ENGINE_NAMES].reverse();
}

export async function runBench(config: BenchConfig): Promise<BenchReport> {
  const { file, warmups = 2, runs = 10 } = config;
  const progress = config.onProgress ?? (() => {});
  const data = await file.arrayBuffer();

  progress("Starting Osmix workers…");
  const [osmix, osmixInitMs] = await timed(() => OsmixEngine.create(config.osmixWorkers));
  progress("Starting DuckDB and loading the spatial extension…");
  const [duckdb, duckdbInitMs] = await timed(() => DuckDBEngine.create());
  const engines: Record<EngineName, BenchEngine> = { Osmix: osmix, DuckDB: duckdb };
  const initializeMs: Record<EngineName, number> = { Osmix: osmixInitMs, DuckDB: duckdbInitMs };

  try {
    const setup = {} as Record<EngineName, SetupResult>;
    for (const name of ENGINE_NAMES) {
      progress(`${name}: loading ${file.name}…`);
      // Each engine gets its own copy; Osmix transfers the buffer to its worker.
      const [load, loadMs] = await timed(() => engines[name].load(data.slice(0), file.name));
      setup[name] = {
        initializeMs: initializeMs[name],
        loadMs,
        load,
        memory: await engines[name].memory(),
        info: engines[name].info(),
      };
    }
    if (setup.Osmix.load.counts.nodes !== setup.DuckDB.load.counts.nodes) {
      throw Error(
        `Engines loaded different node counts: Osmix ${setup.Osmix.load.counts.nodes}, DuckDB ${setup.DuckDB.load.counts.nodes}`,
      );
    }

    const operations: OperationResult[] = [];
    let geojson: Record<EngineName, string> | null = null;
    for (const [index, operation] of buildOperations(setup.Osmix.load.bbox).entries()) {
      progress(`${operation.title}: checking answers…`);
      const cold = {} as Record<EngineName, number>;
      const answers = {} as Record<EngineName, QueryResult>;
      const duckdbPlan = await duckdb.explain(operation.spec);
      let error: string | undefined;
      for (const name of engineOrder(index)) {
        try {
          [answers[name], cold[name]] = await timed(() => engines[name].query(operation.spec));
        } catch (cause) {
          error = `${name} failed: ${cause instanceof Error ? cause.message : String(cause)}`;
          break;
        }
      }
      if (error) {
        operations.push({ operation, error, duckdbPlan });
        continue;
      }
      const parity = compareResults(answers.Osmix, answers.DuckDB);
      if (
        answers.Osmix.kind === "geojson" &&
        answers.DuckDB.kind === "geojson" &&
        answers.Osmix.text.length < MAP_GEOJSON_LIMIT &&
        answers.DuckDB.text.length < MAP_GEOJSON_LIMIT
      ) {
        geojson = { Osmix: answers.Osmix.text, DuckDB: answers.DuckDB.text };
      }
      if (!parity.equal) {
        operations.push({ operation, parity, duckdbPlan });
        continue;
      }

      progress(`${operation.title}: ${warmups} warmups, ${runs} timed runs…`);
      for (let i = 0; i < warmups; i++) {
        for (const name of engineOrder(i)) await engines[name].query(operation.spec);
      }
      const samples: Record<EngineName, number[]> = { Osmix: [], DuckDB: [] };
      for (let i = 0; i < runs; i++) {
        for (const name of engineOrder(i)) {
          const [, ms] = await timed(() => engines[name].query(operation.spec));
          samples[name].push(ms);
        }
      }
      operations.push({
        operation,
        parity,
        duckdbPlan,
        timings: {
          Osmix: { cold: cold.Osmix, ...summarize(samples.Osmix) },
          DuckDB: { cold: cold.DuckDB, ...summarize(samples.DuckDB) },
        },
      });
    }

    return {
      file: { name: file.name, bytes: file.size },
      environment: {
        crossOriginIsolated: globalThis.crossOriginIsolated,
        hardwareConcurrency: navigator.hardwareConcurrency,
        userAgent: navigator.userAgent,
      },
      config: { warmups, runs },
      setup,
      operations,
      geojson,
    };
  } finally {
    await Promise.all([osmix.dispose(), duckdb.dispose()]);
  }
}
