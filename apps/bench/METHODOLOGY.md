# Osmix vs DuckDB-wasm: methodology

This page explains what the benchmark in `apps/bench` measures, how each engine is set up, and where the comparison has limits. It is written for people who know DuckDB. If you can make the DuckDB side faster, please open a pull request: the SQL is in [`src/engines/duckdb-sql.ts`](src/engines/duckdb-sql.ts), and the app shows each statement next to its result.

## What is compared

Both engines run in the same browser tab, each in its own Web Worker:

|                     | Osmix                                                                  | DuckDB                                                                                |
| ------------------- | ---------------------------------------------------------------------- | ------------------------------------------------------------------------------------- |
| Build               | `osmix` from this repository                                           | `@duckdb/duckdb-wasm` 1.33.1-dev57.0 (DuckDB v1.5.4), `spatial` and `json` extensions |
| Threads             | One worker pool. The page's toggle sets it to 1 worker to match DuckDB | 1 (see [Threads](#threads))                                                           |
| Storage             | Typed arrays in `SharedArrayBuffer`s                                   | In-memory database                                                                    |
| Query interface     | JavaScript functions in a worker                                       | SQL                                                                                   |
| Results to the page | Transferred typed arrays                                               | Arrow IPC                                                                             |

This is duckdb-wasm, not native DuckDB. Native DuckDB is multi-threaded, has no 4 GB wasm memory limit, and can spill to disk. The results say nothing about native DuckDB.

## Fairness rules

1. **DuckDB is set up the way a DuckDB user would set it up.** The PBF is read with `ST_ReadOSM`, normalized into `nodes` and `ways` tables with `GEOMETRY` columns, and indexed with RTREEs. Queries use the predicates the RTREE can answer. Where the obvious SQL was slow for a reason a DuckDB user would fix, the bench uses the fix. The notes below list each one.
2. **Each query has one written meaning.** Both engines implement it, and the app shows it next to the result.
3. **Answers are checked before timings count.** Each query runs once on each engine, and the results are compared by ID set (plus counts for aggregates, coordinate counts for GeoJSON, and feature IDs per layer for tiles). A row that differs is shown in red and is not timed.
4. **Both engines cross a worker boundary.** Osmix queries run inside the Osmix worker, and results come back to the page, as DuckDB's do. Timings run from the page and include that round trip.
5. **Statistics:** 2 untimed warmups, then 10 timed runs per engine, reported as median and p95. Engine order alternates on each run. The cold first run is reported separately.
6. **No single score.** Each row has its own ratio. Rows where DuckDB is faster are part of the result, and one row (tag aggregation) was included because DuckDB is expected to win it.

## Load

For both engines, Load means "ready to answer every query in the bench."

**Osmix** parses the PBF, builds ID and tag indexes, and builds the spatial indexes the queries use: a KD-tree over all nodes, a KD-tree over tagged nodes, and a Flatbush R-tree over way bounding boxes. It skips the relation index because no query uses relations. The page shows the exact call.

**DuckDB** runs these statements (shortened; the page shows them in full):

1. `CREATE TABLE raw AS SELECT * FROM ST_ReadOSM(...)`
2. `nodes`: `id`, `tags`, `ST_Point(lon, lat)`.
3. `way_lines`: `UNNEST(refs) WITH ORDINALITY`, joined to `nodes`, then `ST_MakeLine(list(geom ORDER BY pos))` per way.
4. `ways`: `raw` ways joined to `way_lines` for tags.
5. Drop the temporary tables.
6. `CREATE INDEX ... USING RTREE (geom)` on both tables.

Relations are read by `ST_ReadOSM` and then dropped.

Two DuckDB details matter here:

- **The tags MAP stays out of the way-line `GROUP BY`.** The first version carried `any_value(tags)` through the aggregate. It ran out of memory (3.1 GiB) on a 29 MB extract. Building the lines alone and joining the tags back keeps `duckdb_memory()` under 0.8 GiB between steps.
- **Why build geometry at load at all?** Without the `GEOMETRY` columns and RTREEs, every spatial query would rebuild points and lines and scan every row. That moves the load cost into each query. The bench builds them once, as Osmix builds its indexes once.

## Queries

The app shows the exact SQL, DuckDB's plan operators, and a description of each side. The notes below cover choices a DuckDB reader might question.

| Query                       | Meaning                                                                                                                   | Notes                                                                                                                                                                                                                                                                                               |
| --------------------------- | ------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Bbox nodes (S/M/L)          | Node IDs inside a square, edges included. The square is 1%, 10%, or 50% of the dataset's shorter side.                    | `ST_Intersects`. DuckDB's planner uses the RTREE only when the table has at least 8,192 rows (`rtree_index_scan_min_rows`) and it expects under 7.5% of rows to match. On small extracts it scans instead.                                                                                          |
| Bbox way candidates (S/M/L) | Way IDs whose bbox intersects the square.                                                                                 | `&&` uses the RTREE. `ST_Intersects_Extent` means the same thing but never uses the index.                                                                                                                                                                                                          |
| Bbox ways, exact (S/M/L)    | Way IDs whose line touches the square.                                                                                    | `ST_Intersects` on LINESTRINGs. Closed ways are lines, not areas, on both sides.                                                                                                                                                                                                                    |
| 5 nearest nodes             | The 5 nodes closest to the center by haversine distance, ties broken by lower ID.                                         | DuckDB's RTREE answers filters, not nearest-neighbor queries. A single `ORDER BY ST_Distance_Sphere(...) LIMIT 5` scans every node (about 630 ms on 2.7M nodes). Both engines therefore use the same widening search: a bbox prefilter around a 250 m radius, grown 4× until 5 nodes are inside it. |
| Ways with `highway=*`       | IDs of ways with a `highway` tag.                                                                                         | Osmix uses a reverse tag-key index built at load; DuckDB uses `map_contains`.                                                                                                                                                                                                                       |
| Count ways by `highway`     | Count of ways per `highway` value.                                                                                        | Included because it favors DuckDB: this is a hash aggregate, what columnar engines are built for. Osmix has no aggregate operators; the bench counts values in JavaScript.                                                                                                                          |
| GeoJSON export              | One FeatureCollection string: tagged nodes as Points, ways with 2 or more coordinates as LineStrings, tags as properties. | DuckDB returns one feature per row and JavaScript joins them. `string_agg` over the whole collection ran out of memory on a 29 MB extract. `ST_ReadOSM` has no area rules, so both sides emit lines. Osmix's own exporter also makes Polygons and multipolygons, which the bench does not measure.  |
| Vector tile                 | An MVT of the zoom-14 tile at the center: tagged nodes, and tagged ways clipped to the tile plus a 64-unit buffer.        | The tile SQL uses `MATERIALIZED` CTEs. Inlined, the planner merges the spatial filter with the `ST_AsMVTGeom` filters and scans every node (about 300 ms instead of 5 ms on Seattle). `ST_AsMVT` only accepts 32-bit feature IDs, so DuckDB writes the OSM ID as an `osm_id` property.              |

## Threads

duckdb-wasm has a threaded build (`coi`), and the page is cross-origin isolated so it could load. But the spatial extension built for it fails to link ("mismatch in shared state of memory") in 1.33.1-dev57.0 and dev64.0. Spatial SQL is therefore single-threaded in duckdb-wasm today. For a like-for-like run, tick "Single-threaded Osmix". Osmix loads on one worker either way; extra workers only let queries run on whichever worker is free.

## Moving results to the page

Each timing includes getting the answer into JavaScript on the page:

- Osmix builds a `Float64Array` of IDs in its worker and transfers it without a copy. Strings (GeoJSON) are copied by `postMessage`.
- DuckDB sends Arrow IPC from its worker, and duckdb-wasm decodes it on the page's thread. The bench then turns the `BIGINT` ID column (JavaScript `BigInt`s) into numbers. On a Seattle node bbox query that returns about a million IDs, DuckDB's median was 580 ms: about 386 ms for the query itself (measured as `count(*)`), about 170 ms to transfer and decode the Arrow result, and about 20 ms for the `BigInt` conversion.

## Memory

The two memory numbers are measured differently and should not be compared closely:

- Osmix: total bytes of the typed arrays in the loaded dataset.
- DuckDB: `sum(memory_usage_bytes) FROM duckdb_memory()` after load.

Neither includes the JavaScript heap or the wasm module. DuckDB-wasm's memory limit is about 3.1 GiB, and the whole database must fit in it.

## Initialize

Initialize is shown but not compared. DuckDB's includes downloading the `spatial` and `json` extensions from extensions.duckdb.org, and Osmix's includes starting its worker pool.

## What is not measured

- Areas and multipolygons (Osmix builds them for GeoJSON and tiles; `ST_ReadOSM` does not).
- Tags in vector tiles.
- Routing, merging, and changesets. DuckDB has no equivalent.
- Arbitrary ad-hoc queries. This is DuckDB's main strength: any new question is one SQL statement, while Osmix answers only the questions its API and indexes were built for.
- Native DuckDB, persistence, and datasets larger than wasm memory.

## Datasets

The repository only ships `fixtures/monaco.pbf` (170 KB), which the dev server offers as a one-click example. At that size fixed per-call overhead dominates, so run larger extracts with the file picker. These [Geofabrik](https://download.geofabrik.de/) extracts increase in size (sizes as listed in September 2026):

| Extract                                                                                | Size   |
| -------------------------------------------------------------------------------------- | ------ |
| [Liechtenstein](https://download.geofabrik.de/europe/liechtenstein-latest.osm.pbf)     | 3.3 MB |
| [Malta](https://download.geofabrik.de/europe/malta-latest.osm.pbf)                     | 8.5 MB |
| [Delaware](https://download.geofabrik.de/north-america/us/delaware-latest.osm.pbf)     | 21 MB  |
| [Luxembourg](https://download.geofabrik.de/europe/luxembourg-latest.osm.pbf)           | 45 MB  |
| [Estonia](https://download.geofabrik.de/europe/estonia-latest.osm.pbf)                 | 117 MB |
| [Oregon](https://download.geofabrik.de/north-america/us/oregon-latest.osm.pbf)         | 242 MB |
| [Washington](https://download.geofabrik.de/north-america/us/washington-latest.osm.pbf) | 346 MB |

The larger extracts have not been tested with this bench. On the 29 MB Seattle extract, `duckdb_memory()` reached 771 MiB between load steps. If that grows linearly with file size, DuckDB-wasm's 3.1 GiB limit is near a 110 MB PBF.
