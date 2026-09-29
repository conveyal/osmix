import * as duckdb from "@duckdb/duckdb-wasm";
import eh_worker from "@duckdb/duckdb-wasm/dist/duckdb-browser-eh.worker.js?url";
import mvp_worker from "@duckdb/duckdb-wasm/dist/duckdb-browser-mvp.worker.js?url";
import duckdb_wasm_eh from "@duckdb/duckdb-wasm/dist/duckdb-eh.wasm?url";
import duckdb_wasm from "@duckdb/duckdb-wasm/dist/duckdb-mvp.wasm?url";

import { loadStatements, nearestSql, querySql, SUMMARY_SQL } from "./duckdb-sql";
import {
  type BenchEngine,
  type EngineInfo,
  type LoadPhase,
  type LoadResult,
  type MemoryReport,
  NEAREST_MAX_RADIUS_M,
  NEAREST_RADIUS_GROWTH,
  NEAREST_START_RADIUS_M,
  type QueryResult,
  type QuerySpec,
} from "./types";

/**
 * Single-threaded bundles only. The threaded `coi` bundle loads, but the spatial extension
 * built for it fails to link (a shared-memory mismatch) in duckdb-wasm 1.33.1-dev57.0 and
 * dev64.0, so spatial SQL is not available with threads.
 */
const BUNDLES: duckdb.DuckDBBundles = {
  mvp: { mainModule: duckdb_wasm, mainWorker: mvp_worker },
  eh: { mainModule: duckdb_wasm_eh, mainWorker: eh_worker },
};

type ArrowTable = Awaited<ReturnType<duckdb.AsyncDuckDBConnection["query"]>>;

function column(table: ArrowTable, name: string) {
  const vector = table.getChild(name);
  if (!vector) throw Error(`DuckDB result is missing column "${name}"`);
  return vector;
}

function firstValue(table: ArrowTable, name: string): unknown {
  return column(table, name).get(0);
}

/** Convert a BIGINT id column to doubles. OSM ids fit in a double's 53-bit mantissa. */
function idsFrom(table: ArrowTable): Float64Array {
  const values = column(table, "id").toArray() as BigInt64Array;
  const ids = new Float64Array(values.length);
  for (let i = 0; i < values.length; i++) ids[i] = Number(values[i]);
  return ids;
}

/** Pull operator names such as `RTREE_INDEX_SCAN` out of DuckDB's box-drawn plan. */
function planOperators(plan: string): string[] {
  const operators: string[] = [];
  for (const line of plan.split("\n")) {
    const match = line.match(/^[│\s]*([A-Z][A-Z_]{2,})\s*│/);
    if (match?.[1]) operators.push(match[1]);
  }
  return operators;
}

export class DuckDBEngine implements BenchEngine {
  readonly name = "DuckDB";
  private readonly db: duckdb.AsyncDuckDB;
  private readonly conn: duckdb.AsyncDuckDBConnection;
  private readonly engineInfo: EngineInfo;

  private constructor(
    db: duckdb.AsyncDuckDB,
    conn: duckdb.AsyncDuckDBConnection,
    engineInfo: EngineInfo,
  ) {
    this.db = db;
    this.conn = conn;
    this.engineInfo = engineInfo;
  }

  /**
   * Start DuckDB in its own Web Worker and load the `spatial` and `json` extensions. The
   * extensions download from extensions.duckdb.org, so this includes network time.
   */
  static async create(): Promise<DuckDBEngine> {
    const bundle = await duckdb.selectBundle(BUNDLES);
    if (!bundle.mainWorker) throw Error("DuckDB bundle has no worker");
    const db = new duckdb.AsyncDuckDB(new duckdb.VoidLogger(), new Worker(bundle.mainWorker));
    await db.instantiate(bundle.mainModule, bundle.pthreadWorker);
    const conn = await db.connect();
    await conn.query("INSTALL spatial; LOAD spatial; INSTALL json; LOAD json;");

    const version = String(firstValue(await conn.query("SELECT version() AS v"), "v"));
    const spatial = String(
      firstValue(
        await conn.query(
          "SELECT extension_version AS v FROM duckdb_extensions() WHERE extension_name = 'spatial'",
        ),
        "v",
      ),
    );
    const threads = Number(
      firstValue(await conn.query("SELECT current_setting('threads') AS t"), "t"),
    );
    const bundleName = bundle.mainModule.includes("-eh") ? "eh" : "mvp";
    return new DuckDBEngine(db, conn, {
      name: "DuckDB",
      version: `DuckDB ${version}, duckdb-wasm ${duckdb.PACKAGE_VERSION}, spatial ${spatial}`,
      threads,
      notes: [
        `Bundle: ${bundleName} (single-threaded). The threaded bundle cannot load spatial.`,
        "Runs in one dedicated Web Worker. Results cross postMessage as Arrow IPC.",
        "In-memory database; no persistence between runs.",
      ],
    });
  }

  info(): EngineInfo {
    return this.engineInfo;
  }

  async load(data: ArrayBuffer, fileName: string): Promise<LoadResult> {
    const phases: LoadPhase[] = [];
    const time = async (name: string, run: () => Promise<unknown>) => {
      const start = performance.now();
      await run();
      phases.push({ name, ms: performance.now() - start });
    };

    const path = `/${fileName.replaceAll("'", "")}`;
    await time("Copy file into DuckDB", () =>
      this.db.registerFileBuffer(path, new Uint8Array(data)),
    );
    for (const statement of loadStatements(path)) {
      await time(statement.phase, () => this.conn.query(statement.sql));
    }

    const summary = await this.conn.query(SUMMARY_SQL);
    const value = (name: string) => Number(firstValue(summary, name));
    return {
      phases,
      counts: {
        nodes: value("nodes"),
        ways: value("ways"),
        // Relations are read by ST_ReadOSM but not kept; no query uses them.
        relations: 0,
      },
      bbox: [value("min_lon"), value("min_lat"), value("max_lon"), value("max_lat")],
    };
  }

  /** Widen an RTREE-prefiltered radius until it provably holds the k nearest nodes. */
  private async nearest(spec: Extract<QuerySpec, { kind: "knn" }>): Promise<QueryResult> {
    for (let radiusM = NEAREST_START_RADIUS_M; ; radiusM *= NEAREST_RADIUS_GROWTH) {
      const table = await this.conn.query(nearestSql(spec, radiusM));
      const distances = column(table, "distance").toArray() as Float64Array;
      const farthest = distances[spec.k - 1];
      const complete = farthest !== undefined && farthest <= radiusM;
      if (complete || radiusM >= NEAREST_MAX_RADIUS_M) return { kind: "ids", ids: idsFrom(table) };
    }
  }

  async query(spec: QuerySpec): Promise<QueryResult> {
    if (spec.kind === "knn") return this.nearest(spec);
    const table = await this.conn.query(querySql(spec));
    switch (spec.kind) {
      case "tag-aggregate": {
        const values = column(table, "value").toArray() as string[];
        const counts = column(table, "count").toArray() as BigInt64Array;
        return { kind: "groups", values: Array.from(values), counts: Array.from(counts, Number) };
      }
      case "geojson": {
        const features = column(table, "feature").toArray() as string[];
        return {
          kind: "geojson",
          text: `{"type":"FeatureCollection","features":[${features.join(",")}]}`,
        };
      }
      case "tile":
        return { kind: "tile", bytes: firstValue(table, "tile") as Uint8Array };
      default:
        return { kind: "ids", ids: idsFrom(table) };
    }
  }

  async explain(spec: QuerySpec): Promise<string> {
    const table = await this.conn.query(`EXPLAIN ${querySql(spec)}`);
    const plan = String(firstValue(table, "explain_value"));
    return planOperators(plan).join(" ← ");
  }

  async memory(): Promise<MemoryReport> {
    const table = await this.conn.query(
      "SELECT sum(memory_usage_bytes) AS bytes FROM duckdb_memory()",
    );
    return { bytes: Number(firstValue(table, "bytes")), source: "duckdb_memory()" };
  }

  async dispose() {
    await this.conn.close();
    await this.db.terminate();
  }
}
