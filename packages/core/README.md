# @osmix/core

In-memory OSM entity storage with spatial indexing. This package provides the core data structures for efficiently storing and querying OpenStreetMap nodes, ways, and relations.

## Highlights

- **Memory-efficient storage**: Uses typed arrays and microdegree coordinates (`Int32Array`) to minimize memory footprint while maintaining precision.
- **Spatial indexing**: KDBush for point queries (nodes) and Flatbush for bounding-box queries (ways, relations). Supports both bbox and radius-based geographic queries via geokdbush/geoflatbush.
- **Transferable buffers**: All data structures can be serialized to `ArrayBuffer`/`SharedArrayBuffer` for zero-copy transfer between workers via `transferables()` methods.
- **Tag indexing**: Reverse-index lookup enables fast searches for entities by tag key.
- **Streaming iteration**: Iterate over all entities or sorted by ID without materializing full arrays.

## Installation

```sh
bun add @osmix/core
```

## Usage

### Loading PBF files

`@osmix/core` focuses on the in-memory data structure. To parse `.osm.pbf` files, use the higher-level `osmix` package:

```ts
import { createOsmFromPbf } from "osmix"

const osm = await createOsmFromPbf(Bun.file("./monaco.pbf").stream())
console.log(osm.nodes.size, osm.ways.size, osm.relations.size)
```

### Building fixtures directly

For synthetic data or tests, instantiate `Osm` directly and call `buildIndexes()` / `buildSpatialIndexes()` before querying:

```ts
import { Osm } from "@osmix/core"

const osm = new Osm({ id: "fixture" })

osm.nodes.addNode({
	id: 1,
	lon: -122.4,
	lat: 47.6,
	tags: { amenity: "cafe" },
})

osm.ways.addWay({
	id: 10,
	refs: [1],
	tags: { highway: "service" },
})

osm.buildIndexes()
osm.buildSpatialIndexes()
```

### Querying entities

```ts
// Get by ID
const node = osm.nodes.getById(123)
const way = osm.ways.get({ id: 456 })

// Iterate all entities
for (const node of osm.nodes) {
	console.log(node.id, node.lon, node.lat)
}

// Iterate sorted by ID (useful for PBF export)
for (const way of osm.ways.sorted()) {
	console.log(way.id, way.refs)
}

// Search by tag key
const highways = osm.ways.search("highway")
const cafes = osm.nodes.search("amenity", "cafe")
```

### Spatial queries

```ts
// Bounding box query
const bbox: [number, number, number, number] = [-122.34, 47.57, -122.30, 47.61]
const { ids, positions } = osm.nodes.withinBbox(bbox)
const { ids: wayIds, positions: wayCoords, startIndices } = osm.ways.withinBbox(bbox)

// Radius query (uses great-circle distance)
const nearbyIndexes = osm.nodes.findIndexesWithinRadius(-122.4, 47.6, 10) // 10km

// Get entities from indexes
const nearbyNodes = nearbyIndexes.map((i) => osm.nodes.getByIndex(i))

// Ways/relations use Flatbush for bounding-box intersection
const intersectingWays = osm.ways.intersects(bbox)
const nearestWays = osm.ways.neighbors(-122.4, 47.6, 5, 10) // 5 results, 10km max
```

### Transferring between workers

```ts
// In the main thread
const transferables = osm.transferables()
worker.postMessage(transferables, Object.values(transferables).filter(ArrayBuffer.isView))

// In the worker
const osm = new Osm(transferables)
// Index is already built, ready for queries
```

## API Reference

WIP

## Environment and Limitations

- Requires runtimes with Web Streams, `TextEncoder`/`TextDecoder`, and zlib-compatible `CompressionStream`/`DecompressionStream` (Bun, Node 20+, modern browsers).
- Uses ES2024 resizable `ArrayBuffer` and growable `SharedArrayBuffer` when available.
- Coordinates stored as `Int32Array` microdegrees (1e-7 degree precision, ~1cm at the equator) for memory efficiency; conversion to degrees happens at API boundaries.

## Related Packages

- [`osmix`](../osmix/README.md) — High-level API for loading PBF files and worker orchestration.
- [`@osmix/pbf`](../pbf/README.md) — Low-level PBF parsing and serialization.
- [`@osmix/geojson`](../geojson/README.md) — Convert entities to GeoJSON features.
- [`@osmix/change`](../change/README.md) — Changeset generation, deduplication, and merge workflows.

## Development

```sh
# Run tests
bun run test

# Type check
bun run typecheck

# Lint
bun run lint
```

Run `bun run check` at the repo root before publishing to ensure formatting, lint, and type coverage.
