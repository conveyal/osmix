# Osmix

> High-performance OpenStreetMap tools for TypeScript and JavaScript environments.

## Introduction

Osmix is a collection of composable libraries for reading, querying, merging, and transforming OpenStreetMap PBF data in browsers and Node.js. Built on streaming APIs and Web Workers, Osmix handles large extracts efficiently with spatial indexing, vector tile generation, and in-browser merge workflows.

**Key Features:**
- 🚀 Streaming PBF parsing with minimal memory overhead
- 🗺️ Spatial queries via R-tree indexes
- 🔀 Merge and deduplicate OSM extracts
- 🌐 Cross-platform – ESM-native, runs in Node.js, Bun, Deno, and browsers
- 🎨 Generate raster and vector tiles
- 🧵 Worker-based processing for responsive UIs

**Try it:** [merge.osmix.dev](https://merge.osmix.dev)

## Quick Start

```bash
bun install osmix
```

### Examples

```ts
import {Osmix} from 'osmix'

// Get a PBF file
const monacoPbf = await Bun.file('./monaco.pbf').arrayBuffer()

// Load PBF
const osm = await Osmix.fromPbf(monacoPbf)

// Query entities by ID
const node = osm.nodes.getById(123456)
const way = osm.ways.getById(789012)
const relation = osm.relations.getById(345678)

// Spatial queries with bounding box
const bbox: [number, number, number, number] = [7.41, 43.72, 7.43, 43.74]
const nodeResults = osm.nodes.withinBbox(bbox)
const wayResults = osm.ways.withinBbox(bbox)
console.log(`Found ${nodeResults.ids.length} nodes and ${wayResults.ids.length} ways`)

// Stream parse an OSM PBF into easy to use entities
for await (const entity of Osmix.transformOsmPbfToJson(Bun.file("./monaco.pbf").stream())) {
	console.log(entity.id, entity.tags)
	if (isNode()) {
		console.log(entity.lon, entity.lat)
	}
}

// Write the PBF
await Bun.write('./new-monaco.pbf', await osm.toPbf())

// Merge two OSM PBF files
const monacoPatch = await Bun.file('./monaco-patch.pbf').arrayBuffer()
const mergedOsm = await osm.merge(await Osmix.fromPbf(monacoPatch))

// Extract a bounding box
const extract = osmix.extract(bbox)
```

#### Use in a Web Worker

```ts
// main.ts
import {OsmixRemote} from 'osmix'

const remote = await OsmixRemote.connect()
const osmInfo = await remote.fromPbf(monacoPbf)

// Operations run off the main thread
const tile = await remote.getVectorTile(osmInfo.id, [9372, 12535, 15])
```

## Monorepo Structure

See each package's README for full API and description.

| Package | Description |
|--|--|
| [`osmix`](packages/osmix/README.md) | Main library packaging all of the individual tools into an API. |
| [`@osmix/core`](packages/core/README.md) | In-memory data structures for storing entities, building indexes, and emitting OSM data. |
| [`@osmix/change`](packages/change/README.md) | Helpers for deduplication, merging, and applying changesets atop core data. |
| [`@osmix/json`](packages/json/README.md) | Streaming transforms: convert OSM PBF bytes to strongly typed JSON. |
| [`@osmix/geojson`](packages/geojson/README.md) | Convert OSM to and from GeoJSON. |
| [`@osmix/pbf`](packages/pbf/README.md) | Low-level library for OSM PBF protobuf parsing and writing. |
| [`@osmix/raster`](packages/raster/README.md) | Renders OSM entities as raster bitmaps. |
| [`@osmix/vt`](packages/vt/README.md) | Encodes OSM entities as Mapbox Vector Tiles (MVT). |
| [`@osmix/shared`](packages/shared/README.md) | Utility functions and geometry helpers used throughout all workspace packages. |
| [`@osmix/router`](packages/router/README.md) | Experimental, naive router. WIP. |


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

- **[merge](apps/merge/README.md)** – Interactive merge tool for OSM extracts with MapLibre visualization ([live demo](https://merge.osmix.dev))
- **[bench](apps/bench/README.md)** – Performance benchmarks comparing Osmix with DuckDB-wasm
- **[vt-server](apps/vt-server/README.md)** – Example vector tile server implementation

## Resources

- [OpenStreetMap PBF format](https://wiki.openstreetmap.org/wiki/PBF_Format)
- [Bun](https://bun.sh/) workspace documentation
- [MapLibre GL JS](https://maplibre.org/projects/maplibre-gl-js/)
- [Web Compression Streams API](https://developer.mozilla.org/docs/Web/API/Compression_Streams_API)
