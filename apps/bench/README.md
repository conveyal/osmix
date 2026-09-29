# @osmix/bench

A browser benchmark of Osmix against DuckDB-wasm on OSM PBF data. Both engines load the same file and answer the same queries. A query is only timed after both engines return the same answer.

Read [METHODOLOGY.md](METHODOLOGY.md) for how each engine is set up, what each query means, and where the comparison has limits.

## What it measures

- **Setup:** initialize each engine, and load a PBF until every query below can run. Load is split into each engine's own phases.
- **Queries:** node and way bbox queries at three sizes, way bbox queries with exact line intersection, 5 nearest nodes, a tag filter, a tag aggregation, GeoJSON export, and one vector tile.

For each query the page shows median, p95, and cold times; the exact DuckDB SQL and its plan operators; and how Osmix answers it.

## Usage

```bash
pnpm --filter @osmix/bench run dev
```

In development, "Use monaco.pbf" loads `fixtures/monaco.pbf`. Use the file picker for larger extracts; METHODOLOGY.md lists some. Tick "Single-threaded Osmix" to give Osmix one worker, matching DuckDB-wasm's single thread.

## Code

- `src/operations.ts`: every query, its meaning, and each engine's approach.
- `src/engines/duckdb-sql.ts`: all DuckDB SQL. The page shows these strings.
- `src/engines/duckdb-engine.ts`, `src/engines/osmix-engine.ts`: the two engines behind one `BenchEngine` interface.
- `src/engines/osmix-queries.ts`, `src/workers/osmix-bench.worker.ts`: Osmix queries, run in an Osmix worker.
- `src/harness/`: the runner, answer comparison, and statistics.

## Tests

```bash
pnpm --filter @osmix/bench run test
```

The tests run in a browser. `test/parity.test.ts` runs every query on `monaco.pbf` and fails if the engines' answers differ. Browser tests are skipped in CI.
