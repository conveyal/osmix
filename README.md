# Osmix

> High-performance OpenStreetMap tools for TypeScript and JavaScript environments.

## Introduction

Osmix is a collection of composable libraries for reading, querying, merging, and transforming OpenStreetMap PBF data in browsers and Node.js. Built on streaming APIs and Web Workers, Osmix handles large extracts efficiently with spatial indexing, vector tile generation, and in-browser merge workflows.

**Key Features:**
- 🚀 Streaming PBF parsing with minimal memory overhead
- 🗺️ Spatial queries via R-tree indexes
- 🔀 Merge and deduplicate OSM extracts
- 🎨 Generate raster and vector tiles
- 🧵 Worker-based processing for responsive UIs
- 📦 Zero native dependencies

**Try it:** [merge.osmix.dev](https://merge.osmix.dev)

## Quick Start

```bash
bun install osmix
```

### Load and query OSM data

```ts
import {Osmix} from 'osmix'

// Load PBF from file or URL
const osm = await Osmix.fromPbf(Bun.file('monaco.pbf').stream())

// Query entities
const node = osm.getNode(123456)
const way = osm.getWay(789012)
const relation = osm.getRelation(345678)

// Spatial queries with bounding box
const entities = osm.queryBbox([7.41, 43.72, 7.43, 43.74])
console.log(`Found ${entities.nodes.length} nodes in Monaco harbor`)
```

### Merge two OSM extracts

```ts
import {Osmix} from 'osmix'

const base = await Osmix.fromPbf(Bun.file('region-base.pbf').stream())
const patch = await Osmix.fromPbf(Bun.file('region-updates.pbf').stream())

// Merge patch into base, deduplicating entities
const merged = await base.merge(patch)

// Write merged result
await Bun.write('region-merged.pbf', merged.toPbf())
```

### Extract a bounding box

```ts
import {Osmix} from 'osmix'

const osm = await Osmix.fromPbf(Bun.file('washington.pbf').stream())

// Extract downtown Seattle
const bbox = [-122.34, 47.60, -122.32, 47.61]
const extract = osm.extract(bbox)

await Bun.write('seattle-downtown.pbf', extract.toPbf())
```

### Use in a Web Worker

```ts
// main.ts
import {OsmixRemote} from 'osmix'

const Osmix = await OsmixRemote.connect()
const osm = await Osmix.fromPbf(file.stream())

// All operations run off the main thread
const entities = await osm.queryBbox([7.41, 43.72, 7.43, 43.74])
```

### Convert to GeoJSON

```ts
import {Osmix} from 'osmix'
import {entityToFeature} from 'osmix/geojson'

const osm = await Osmix.fromPbf(Bun.file('monaco.pbf').stream())
const way = osm.getWay(123456)

// Convert OSM entity to GeoJSON Feature
const feature = entityToFeature(way, osm)
console.log(feature.geometry.type) // 'LineString' or 'Polygon'
```

## Monorepo Structure

| Package | Description | README |
|--|--|--|
| 'osmix' | Main library packaging all of the individual tools into an API. | [README](packages/osmix/README.md) |
| `@osmix/core` | In-memory engine for ingesting PBF streams, building indexes, and emitting OSM data. | [README](packages/core/README.md) |
| `@osmix/change` | Helpers for deduplication, merge stats, and applying changesets atop core data. | [README](packages/change/README.md) |
| `@osmix/json` | Streaming transforms: convert OSM PBF bytes to strongly typed JSON and GeoJSON. | [README](packages/json/README.md) |
| `@osmix/pbf` | Low-level library for OSM PBF protobuf parsing, compression, and code generation. | [README](packages/pbf/README.md) |
| `@osmix/raster` | Renders canvased raster tiles and registers the custom MapLibre protocol for Osmix. | [README](packages/raster/README.md) |
| `@osmix/vt` | Encodes overlays as Mapbox Vector Tiles (MVT) and provides caching helpers. | [README](packages/vt/README.md) |
| `@osmix/shared` | Utility functions and geometry helpers used throughout all workspace packages. | [README](packages/shared/README.md) |


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
- [Vite](https://vitejs.dev/) build tooling
- [MapLibre GL JS](https://maplibre.org/projects/maplibre-gl-js/)
- [Web Compression Streams API](https://developer.mozilla.org/docs/Web/API/Compression_Streams_API)
