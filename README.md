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
bun add osmix
```

### Examples

```ts
import { fromPbf, toPbfBuffer, transformOsmPbfToJson, merge, isNode } from "osmix"

// Load a PBF file
const osm = await fromPbf(Bun.file('./monaco.pbf').stream())

// Query entities by ID
const node = osm.nodes.getById(123456)
const way = osm.ways.getById(789012)
const relation = osm.relations.getById(345678)

// Spatial queries with bounding box
const bbox: [number, number, number, number] = [7.41, 43.72, 7.43, 43.74]
const nodeResults = osm.nodes.withinBbox(bbox)
const wayResults = osm.ways.withinBbox(bbox)
console.log(`Found ${nodeResults.ids.length} nodes and ${wayResults.ids.length} ways`)

// Stream parse a PBF into JSON entities
const stream = transformOsmPbfToJson(Bun.file("./monaco.pbf").stream())
for await (const entity of stream) {
	if ("id" in entity) {
		console.log(entity.id, entity.tags)
		if (isNode(entity)) {
			console.log(entity.lon, entity.lat)
		}
	}
}

// Write the PBF
await Bun.write('./new-monaco.pbf', await toPbfBuffer(osm))

// Merge two OSM PBF files
const patchOsm = await fromPbf(Bun.file('./monaco-patch.pbf').stream())
const mergedOsm = merge(osm, patchOsm)
```

### Use in a Web Worker

```ts
import { createRemote } from "osmix"

// main.ts
const remote = await createRemote()
const osm = await remote.fromPbf(monacoPbf) // Returns a dataset handle

// Operations run off the main thread
const tile = await osm.getVectorTile([9372, 12535, 15])
```

## Monorepo Structure

See each package's README for full API and description.

| Package | Description |
|---------|-------------|
| [`osmix`](packages/osmix/README.md) | Main library packaging all tools into a unified API. |
| [`@osmix/core`](packages/core/README.md) | In-memory data structures for storing entities, building indexes, and spatial queries. |
| [`@osmix/pbf`](packages/pbf/README.md) | Low-level PBF protobuf parsing and writing. |
| [`@osmix/json`](packages/json/README.md) | Streaming transforms: PBF bytes ↔ typed JSON entities. |
| [`@osmix/geojson`](packages/geojson/README.md) | Convert OSM entities to/from GeoJSON. |
| [`@osmix/geoparquet`](packages/geoparquet/README.md) | GeoParquet import. |
| [`@osmix/gtfs`](packages/gtfs/README.md) | GTFS feed import. |
| [`@osmix/shapefile`](packages/shapefile/README.md) | Shapefile import. |
| [`@osmix/change`](packages/change/README.md) | Deduplication, merging, and changeset workflows. |
| [`@osmix/raster`](packages/raster/README.md) | Render OSM entities as raster bitmaps. |
| [`@osmix/vt`](packages/vt/README.md) | Encode OSM entities as Mapbox Vector Tiles (MVT). |
| [`@osmix/shortbread`](packages/shortbread/README.md) | Shortbread schema vector tiles. |
| [`@osmix/shared`](packages/shared/README.md) | Utility functions and geometry helpers. |
| [`@osmix/router`](packages/router/README.md) | Experimental routing. WIP. |


## Development

```bash
# Install dependencies
bun install

# Run all apps in watch mode
bun run dev

# Build all packages
bun run build

# Run tests
bun run test

# Type check
bun run typecheck

# Format and lint
bun run check
```

**Workspace commands** support filtering: `bun run --filter @osmix/merge dev`

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
- [Bun](https://bun.sh/) workspace documentation
- [MapLibre GL JS](https://maplibre.org/projects/maplibre-gl-js/)
- [Web Compression Streams API](https://developer.mozilla.org/docs/Web/API/Compression_Streams_API)
