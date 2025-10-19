# @osmix/bench

Performance benchmark app comparing Osmix vs DuckDB-wasm for OSM data operations.

## Overview

This app provides experimental benchmarking of Osmix and DuckDB-wasm across multiple OSM operations:

- **Load Speed**: Time to load and index OSM PBF files
- **Bbox Queries**: Small, Medium, and Large bounding box queries
- **Nearest Neighbor**: Find N nearest nodes to a point
- **Vector Tile Generation**: Planned support for streaming Mapbox Vector Tiles from benchmarked data.
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

## Known limitations

- Vector tile generation currently returns raw node buffers; hook this up to [`@osmix/geojson-binary-vt`](../../packages/geojson-binary-vt/README.md) or raster helpers before publishing benchmark results.
- DuckDB-backed runs skip index creation (`createSpatialIndexes`) so larger extracts may benchmark slower than necessary.
- `includeTags` flags in bounding-box and nearest-neighbor queries are ignored in the Osmix worker; the UI exposes the switches, but results only include ids/geometry today.
- Benchmarks execute entirely in the browser and do not persist results; refresh the page to reset runs.
