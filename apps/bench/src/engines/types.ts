import type { GeoBbox2D, Tile } from "@osmix/types";

/** Vector tile extent and clip buffer, in tile units, used by both engines. */
export const TILE_EXTENT = 4096;
export const TILE_BUFFER = 64;

/** Widening radius search both engines use for nearest nodes. */
export const NEAREST_START_RADIUS_M = 250;
export const NEAREST_RADIUS_GROWTH = 4;
/** Half of Earth's circumference: a radius this large covers every point. */
export const NEAREST_MAX_RADIUS_M = 20_037_509;

export type EngineName = "Osmix" | "DuckDB";

/**
 * A query that both engines answer. Each kind has one precise meaning, documented in
 * `operations.ts`, and both engines must return the same answer for it.
 */
export type QuerySpec =
  | { kind: "bbox-nodes"; bbox: GeoBbox2D }
  | { kind: "bbox-way-candidates"; bbox: GeoBbox2D }
  | { kind: "bbox-ways-exact"; bbox: GeoBbox2D }
  | { kind: "knn"; lon: number; lat: number; k: number }
  | { kind: "tag-filter"; key: string }
  | { kind: "tag-aggregate"; key: string }
  | { kind: "geojson" }
  | { kind: "tile"; tile: Tile; bbox: GeoBbox2D };

/** What a query returns to the main thread. */
export type QueryResult =
  | { kind: "ids"; ids: Float64Array }
  | { kind: "groups"; values: string[]; counts: number[] }
  | { kind: "geojson"; text: string }
  | { kind: "tile"; bytes: Uint8Array };

export interface LoadPhase {
  name: string;
  ms: number;
}

export interface LoadResult {
  /** Engine-reported sub-phases. They may not add up to the total the harness measures. */
  phases: LoadPhase[];
  counts: { nodes: number; ways: number; relations: number };
  /** Extent of all nodes. The harness centers every query on it. */
  bbox: GeoBbox2D;
}

export interface EngineInfo {
  name: EngineName;
  version: string;
  /** Threads the engine can use for this run. */
  threads: number;
  /** Plain statements about how the engine is configured. */
  notes: string[];
}

export interface MemoryReport {
  bytes: number;
  source: string;
}

/** The interface the harness uses to drive each engine. */
export interface BenchEngine {
  readonly name: EngineName;
  info(): EngineInfo;
  load(data: ArrayBuffer, fileName: string): Promise<LoadResult>;
  query(spec: QuerySpec): Promise<QueryResult>;
  /** Describe how a query executes, such as the operators in a query plan. */
  explain(spec: QuerySpec): Promise<string | null>;
  memory(): Promise<MemoryReport>;
  dispose(): Promise<void>;
}
