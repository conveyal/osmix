# @osmix/bench

Performance benchmark app comparing Osmix vs DuckDB-wasm for OSM data operations.

## Overview

This app provides experimental benchmarking of Osmix and DuckDB-wasm across multiple OSM operations:

- **Load Speed**: Time to load and index OSM PBF files
- **Bbox Queries**: Small, Medium, and Large bounding box queries
- **Nearest Neighbor**: Find N nearest nodes to a point
- **Vector Tile Generation**: TODO
- **GeoJSON Export**: Convert query results to GeoJSON format

## Usage

### Development

```bash
bun run dev
```

Automatically loads `fixtures/monaco.pbf` and runs benchmarks.

### Custom Files

Click "Select PBF File" to load your own OSM PBF file. Benchmarks run automatically after loading.

## Dependencies

- `@osmix/core`, `@osmix/json`, `@osmix/pbf` - Osmix packages
- `@duckdb/duckdb-wasm` - DuckDB WebAssembly with spatial extension
- `maplibre-gl` - Map visualization

