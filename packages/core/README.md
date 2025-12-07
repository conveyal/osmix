# @osmix/core

In-memory OSM entity storage with spatial indexing. Provides core data structures for efficiently storing and querying OpenStreetMap nodes, ways, and relations.

## Highlights

- **Memory-efficient**: Typed arrays and microdegree coordinates (`Int32Array`) minimize memory while maintaining precision.
- **Spatial indexing**: KDBush (points) and Flatbush (bboxes) for fast geographic queries. Supports bbox and radius searches via geokdbush/geoflatbush.
- **Worker-ready**: Serialize to `ArrayBuffer`/`SharedArrayBuffer` for zero-copy transfer via `transferables()`.
- **Tag search**: Reverse-index lookup for fast entity searches by tag key.
- **Streaming**: Iterate entities or sorted-by-ID without materializing full arrays.

## Installation

```sh
bun add @osmix/core
```

## Usage

### Loading PBF files

`@osmix/core` provides the in-memory data structures. To parse `.osm.pbf` files, use the high-level `osmix` package:

```ts
import { fromPbf } from "osmix"

const osm = await fromPbf(Bun.file("./monaco.pbf").stream())
console.log(osm.nodes.size, osm.ways.size, osm.relations.size)
```

### Building data directly

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

## API

### Classes

| Class | Description |
|-------|-------------|
| `Osm` | Main container with nodes, ways, relations, and shared string table |
| `Nodes` | Node storage with KDBush spatial index |
| `Ways` | Way storage with Flatbush spatial index |
| `Relations` | Relation storage with Flatbush spatial index |
| `StringTable` | Deduplicated UTF-8 string storage for tags |
| `Tags` | Bidirectional tag storage (entity→tags, key→entities) |

### Osm Methods

| Method | Description |
|--------|-------------|
| `buildIndexes()` | Finalize ID, tag, and entity indexes after adding data |
| `buildSpatialIndexes()` | Build spatial indexes for all entity types |
| `bbox()` | Get bounding box of all entities |
| `info()` | Get summary info (id, bbox, header, stats) |
| `transferables()` | Get serializable buffers for worker transfer |
| `isReady()` | Check if all indexes are built |

### Entity Collection Methods

| Method | Description |
|--------|-------------|
| `getById(id)` | Get entity by OSM ID |
| `get({ id } \| { index })` | Get by ID or internal index |
| `getByIndex(index)` | Get by internal array index |
| `search(key, value?)` | Find entities with tag key (and optional value) |
| `withinBbox(bbox)` | Get entities within bounding box |
| `findIndexesWithinRadius(lon, lat, km)` | Find nearby entities (nodes) |
| `intersects(bbox)` | Find intersecting entities (ways/relations) |
| `neighbors(lon, lat, max, maxKm)` | Find nearest entities (ways/relations) |
| `sorted()` | Iterator over entities sorted by ID |

## Environment and Limitations

- Requires Web Streams, `TextEncoder`/`TextDecoder`, `CompressionStream`/`DecompressionStream` (Bun, Node 20+, modern browsers).
- Uses ES2024 resizable `ArrayBuffer` and growable `SharedArrayBuffer` when available.
- Coordinates stored as `Int32Array` microdegrees (1e-7 degree precision, ~1cm at equator); converted to degrees at API boundaries.

## Related Packages

- [`osmix`](../osmix/README.md) — High-level API for loading PBF files and worker orchestration.
- [`@osmix/pbf`](../pbf/README.md) — Low-level PBF parsing and serialization.
- [`@osmix/json`](../json/README.md) — JSON entity conversion.
- [`@osmix/geojson`](../geojson/README.md) — Convert entities to GeoJSON features.
- [`@osmix/change`](../change/README.md) — Changeset generation, deduplication, and merge.

## Development

```sh
bun run test packages/core
bun run typecheck packages/core
bun run lint packages/core
```

Run `bun run check` at the repo root before publishing.
