# Osmix

> High-performance OpenStreetMap tools for TypeScript and JavaScript environments.

## Introduction

Osmix is a collection of composable libraries for reading, querying, merging, and transforming OpenStreetMap PBF data in browsers and Node.js. Built on streaming APIs and Web Workers, Osmix handles large extracts efficiently with spatial indexing, vector tile generation, and in-browser merge workflows.

**Key Features:**

- Streaming PBF parsing with minimal memory overhead
- Spatial queries via R-tree indexes (KDBush, Flatbush)
- Merge and deduplicate OSM extracts
- Cross-platform – ESM-native, runs in Node.js, Bun, Deno, and browsers
- Generate raster and vector tiles
- Worker-based processing for responsive UIs

**Try it:** [merge.osmix.dev](https://merge.osmix.dev) · **Docs & examples:** [osmix.dev](https://osmix.dev)

## Quick Start

```bash
pnpm add osmix
```

### Examples

```ts check-docs
import { fromPbf, toPbfBuffer, transformOsmPbfToJson, merge, isNode } from "osmix";

// Load a PBF file
const monacoResponse = await fetch("./monaco.pbf");
const monacoPbf = new Uint8Array(await monacoResponse.arrayBuffer());
const osm = await fromPbf(monacoPbf);

// Query entities by ID
const node = osm.nodes.getById(123456);
const way = osm.ways.getById(789012);
const relation = osm.relations.getById(345678);
console.log(node, way, relation);

// Spatial queries with bounding box
const bbox: [number, number, number, number] = [7.41, 43.72, 7.43, 43.74];
const nodeResults = osm.nodes.withinBbox(bbox);
const wayResults = osm.ways.withinBbox(bbox);
console.log(`Found ${nodeResults.ids.length} nodes and ${wayResults.ids.length} ways`);

// Stream parse a PBF into JSON entities
const stream = transformOsmPbfToJson(monacoPbf.buffer);
for await (const entity of stream) {
  if ("id" in entity) {
    console.log(entity.id, entity.tags);
    if (isNode(entity)) {
      console.log(entity.lon, entity.lat);
    }
  }
}

// Serialize the PBF for a download, upload, or file-system API
const pbfBytes = await toPbfBuffer(osm);
console.log(`Serialized ${pbfBytes.byteLength} bytes`);

// Merge two OSM PBF files
const patchResponse = await fetch("./monaco-patch.pbf");
const patchPbf = new Uint8Array(await patchResponse.arrayBuffer());
const patchOsm = await fromPbf(patchPbf);
const mergedOsm = await merge(osm, patchOsm);
console.log(mergedOsm.id);
```

The high-level merge preserves each source dataset and only reconciles compatible entities across the base
and patch. If a PBF was produced by an older release that automatically deduplicated within each input,
regenerate it from the original source files rather than trying to repair rewritten routing topology.

### Use in a Web Worker

```ts check-docs monaco-pbf
import { createRemote } from "osmix";

// main.ts
using remote = await createRemote();
const osm = await remote.fromPbf(monacoPbf); // Returns a dataset handle

// Operations run off the main thread
const tile = await osm.getVectorTile([9372, 12535, 15]);
console.log(tile.byteLength);
```

`createRemote()` adapts to the runtime: cross-origin isolated browsers get a
multi-worker pool sharing data via `SharedArrayBuffer`, other browsers get a
fully supported single worker, and Node/test environments can opt into
running on the calling thread with `inProcess: true`. See the
[environment support matrix](packages/osmix/README.md#environment-support)
for details, including the COOP/COEP headers required for multi-worker mode.

## Monorepo Structure

See each package's README for full API and description.

| Package                                              | Description                                                                            |
| ---------------------------------------------------- | -------------------------------------------------------------------------------------- |
| [`osmix`](packages/osmix/README.md)                  | Main library packaging all tools into a unified API.                                   |
| [`@osmix/core`](packages/core/README.md)             | In-memory data structures for storing entities, building indexes, and spatial queries. |
| [`@osmix/pbf`](packages/pbf/README.md)               | Low-level PBF protobuf parsing and writing.                                            |
| [`@osmix/json`](packages/json/README.md)             | Streaming transforms: PBF bytes ↔ typed JSON entities.                                 |
| [`@osmix/load`](packages/load/README.md)             | Load PBF into `Osm` indexes, geographic extracts, and PBF export.                      |
| [`@osmix/geojson`](packages/geojson/README.md)       | Convert OSM entities to/from GeoJSON.                                                  |
| [`@osmix/geoparquet`](packages/geoparquet/README.md) | GeoParquet import.                                                                     |
| [`@osmix/gtfs`](packages/gtfs/README.md)             | GTFS feed import.                                                                      |
| [`@osmix/shapefile`](packages/shapefile/README.md)   | Shapefile import.                                                                      |
| [`@osmix/change`](packages/change/README.md)         | Deduplication, merging, and changeset workflows.                                       |
| [`@osmix/raster`](packages/raster/README.md)         | Render OSM entities as raster bitmaps.                                                 |
| [`@osmix/cli`](packages/cli/README.md)               | Explore OSM PBF files in an interactive terminal map.                                  |
| [`@osmix/vt`](packages/vt/README.md)                 | Encode OSM entities as Mapbox Vector Tiles (MVT).                                      |
| [`@osmix/shortbread`](packages/shortbread/README.md) | Shortbread schema vector tiles.                                                        |
| [`@osmix/shared`](packages/shared/README.md)         | Utility functions and geometry helpers.                                                |
| [`@osmix/router`](packages/router/README.md)         | Experimental routing. WIP.                                                             |

## Development

```bash
# Install dependencies
pnpm install

# Run all apps through Portless
pnpm run dev

# Build all packages
pnpm run build

# Run tests
pnpm run test

# Type check
pnpm run typecheck

# Type check complete public documentation examples
pnpm run check:docs

# Format and lint
pnpm run check

# Non-mutating format and lint checks
pnpm run format:check
pnpm run lint:check

# Verify one workspace and its runtime dependents
pnpm run verify:workspace -- @osmix/core

# Verify all non-benchmark workspaces plus dependency and Node smoke checks
pnpm run verify:all
```

**Workspace commands** support filtering: `pnpm --filter @osmix/merge dev`

Development servers use [Portless](https://github.com/vercel-labs/portless) and stable HTTPS URLs: `merge.osmix.localhost`, `bench.osmix.localhost`, `www.osmix.localhost`, `vt.osmix.localhost`, and `shortbread.osmix.localhost`. The first run creates and trusts a local certificate authority; run `pnpm exec portless trust` if trust setup was skipped. Branch-backed worktrees add the sanitized branch name as a prefix, while detached worktrees add their Git worktree ID, so concurrent checkouts do not compete for routes. Filtered commands retain the same naming convention.

Set `PORTLESS=0` to bypass the proxy and run the underlying development command directly, for example `PORTLESS=0 pnpm --filter @osmix/merge dev`. Portless proxy and certificate state are user-level state and are not stored in this repository.

`verify:workspace` accepts a package name or path such as `apps/vt-server`, follows runtime and development workspace dependencies to include dependents, and runs formatting, typechecking, and tests in dependency order. It is check-only by default; pass `--write` only when formatting changes are intentional. `verify:all` excludes the browser benchmark app, whose benchmark script is not a package test.

Complete TypeScript examples are marked `check-docs` and compiled by `check:docs`; partial configuration and application-wiring fragments are labeled `schematic`.

## Apps

- **[www](apps/www/)** – Main site with interactive examples and package overview ([osmix.dev](https://osmix.dev))
- **[merge](apps/merge/README.md)** – Interactive merge tool for OSM extracts with MapLibre visualization ([live demo](https://merge.osmix.dev))
- **[bench](apps/bench/README.md)** – Performance benchmarks comparing Osmix with DuckDB-wasm
- **[vt-server](apps/vt-server/README.md)** – Example vector tile server implementation
- **[shortbread](apps/shortbread/)** – Shortbread schema vector tile server demo

## Resources

- [osmix.dev](https://osmix.dev) – Docs, examples, and package overview
- [GitHub](https://github.com/conveyal/osmix) – Issues and discussions
- [OpenStreetMap PBF format](https://wiki.openstreetmap.org/wiki/PBF_Format)
- [pnpm](https://pnpm.io/) workspace documentation
- [MapLibre GL JS](https://maplibre.org/projects/maplibre-gl-js/)
- [Web Compression Streams API](https://developer.mozilla.org/docs/Web/API/Compression_Streams_API)
