# @osmix/core

In-memory OSM entity storage with spatial indexing. Provides core data structures for efficiently storing and querying OpenStreetMap nodes, ways, and relations.

## Highlights

- **Memory-efficient**: Sorted IDs reuse their primary column, tags use sparse rank metadata, and ways store compact node indexes instead of duplicate OSM IDs.
- **Spatial indexing**: Compact indirect KD indexes for nodes and Flatbush indexes for entity bounding boxes. Supports bbox and great-circle radius searches without copying node coordinates.
- **Worker-ready**: Serialize to `ArrayBuffer`/`SharedArrayBuffer` for zero-copy transfer via `transferables()`.
- **Tag search**: Reverse-index lookup for fast entity searches by tag key.
- **Streaming**: Iterate entities or sorted-by-ID without materializing full arrays.

## Installation

```sh
pnpm add @osmix/core
```

## Usage

### Loading PBF files

`@osmix/core` provides the in-memory data structures. To parse `.osm.pbf` files, use the high-level `osmix` package:

```ts check-docs monaco-pbf
import { fromPbf } from "osmix";

const osm = await fromPbf(monacoPbf);
console.log(osm.nodes.size, osm.ways.size, osm.relations.size);
```

### Building data directly

For synthetic data or tests, instantiate `Osm` directly and call `buildIndexes()` / `buildSpatialIndexes()` before querying:

```ts check-docs
import { Osm } from "@osmix/core";

const osm = new Osm({ id: "fixture" });

osm.nodes.addNode({
  id: 1,
  lon: -122.4,
  lat: 47.6,
  tags: { amenity: "cafe" },
});

osm.ways.addWay({
  id: 10,
  refs: [1],
  tags: { highway: "service" },
});

osm.buildIndexes();
osm.buildSpatialIndexes();
```

### Querying entities

```ts check-docs osm
// Get by ID
const node = osm.nodes.getById(123);
const way = osm.ways.get({ id: 456 });

// Iterate all entities
for (const node of osm.nodes) {
  console.log(node.id, node.lon, node.lat);
}

// Iterate sorted by ID (useful for PBF export)
for (const way of osm.ways.sorted()) {
  console.log(way.id, way.refs);
}

// Search by tag key
const highways = osm.ways.search("highway");
const cafes = osm.nodes.search("amenity", "cafe");
```

### Spatial queries

```ts check-docs osm
// Bounding box query
const bbox: [number, number, number, number] = [-122.34, 47.57, -122.3, 47.61];
const { ids, positions } = osm.nodes.withinBbox(bbox);
const { ids: wayIds, positions: wayCoords, startIndices } = osm.ways.withinBbox(bbox);

// Radius query (uses great-circle distance)
const nearbyIndexes = osm.nodes.findIndexesWithinRadius(-122.4, 47.6, 10); // 10km

// Renderers can build/query only tagged nodes when an all-node index is unnecessary
osm.nodes.buildSpatialIndex("tagged");
const taggedIndexes = osm.nodes.findTaggedIndexesWithinBbox(bbox);

console.log(osm.nodes.hasSpatialIndex("all"));
console.log(osm.nodes.hasSpatialIndex("tagged"));

// Get entities from indexes
const nearbyNodes = nearbyIndexes.map((i) => osm.nodes.getByIndex(i));

// Ways/relations use Flatbush for bounding-box intersection
const intersectingWays = osm.ways.intersects(bbox);
const nearestWays = osm.ways.neighbors(-122.4, 47.6, 5, 10); // 5 results, 10km max
```

### Transferring between workers

The following is schematic worker wiring; use the facade's worker helpers for production orchestration:

```ts schematic
import { collectTransferables, Osm } from "osmix";

// In the main thread
const transferables = osm.transferables();
worker.postMessage(transferables, collectTransferables(transferables));

// In the worker
const osm = new Osm(transferables);
// Index is already built, ready for queries
```

`OsmTransferables` uses `transferVersion: 2` and `contentHashVersion: 2`. Version 2 is an
intentional format break: version 1 transfers are rejected rather than upgraded in memory, and version 1/2
hash values are not interchangeable. Within version 2, hashes remain representation-independent because they
use reconstructed OSM IDs, tags, references, and members rather than derived rank or spatial-index data.

### Compact storage layout

- Sorted entity collections keep the primary ID column and sparse search anchors. Unsorted collections also
  keep the derived sorted-ID and sorted-position columns needed for lookup.
- Tag presence uses one bit per entity, rank checkpoints every 256 entities, and offsets only for tagged
  entities. An entity may have more than 255 tags.
- Way references are stored as `Uint32Array` node indexes. Unresolved references retain their original OSM
  IDs in sparse parallel arrays, so reading `OsmWay.refs` is lossless. Geometry construction still throws when
  a referenced node is unavailable.
- Node spatial indexes are indirect permutations over the existing microdegree coordinate columns. The
  all-node capability uses exactly four bytes per node; the tagged-node capability uses exactly four bytes per
  tagged node.

## API

### Classes

| Class         | Description                                                         |
| ------------- | ------------------------------------------------------------------- |
| `Osm`         | Main container with nodes, ways, relations, and shared string table |
| `Nodes`       | Node storage with independent all-node and tagged-node KD indexes   |
| `Ways`        | Way storage with Flatbush spatial index                             |
| `Relations`   | Relation storage with Flatbush spatial index                        |
| `StringTable` | Deduplicated UTF-8 string storage for tags                          |
| `Tags`        | Bidirectional tag storage (entity→tags, key→entities)               |

### Osm Methods

| Method                  | Description                                            |
| ----------------------- | ------------------------------------------------------ |
| `buildIndexes()`        | Finalize ID, tag, and entity indexes after adding data |
| `buildSpatialIndexes()` | Build spatial indexes for all entity types             |
| `bbox()`                | Get bounding box of all entities                       |
| `info()`                | Get summary info (id, bbox, header, stats)             |
| `transferables()`       | Get serializable buffers for worker transfer           |
| `isReady()`             | Check if all indexes are built                         |

### Entity Collection Methods

| Method                                  | Description                                     |
| --------------------------------------- | ----------------------------------------------- |
| `getById(id)`                           | Get entity by OSM ID                            |
| `get({ id } \| { index })`              | Get by ID or internal index                     |
| `getByIndex(index)`                     | Get by internal array index                     |
| `search(key, value?)`                   | Find entities with tag key (and optional value) |
| `withinBbox(bbox)`                      | Get entities within bounding box                |
| `findIndexesWithinRadius(lon, lat, km)` | Find nearby entities (nodes)                    |
| `intersects(bbox)`                      | Find intersecting entities (ways/relations)     |
| `neighbors(lon, lat, max, maxKm)`       | Find nearest entities (ways/relations)          |
| `sorted()`                              | Iterator over entities sorted by ID             |

`Osm.info()` reports each spatial capability independently at
`spatialIndexes.nodes.all`, `spatialIndexes.nodes.tagged`, `spatialIndexes.ways`, and
`spatialIndexes.relations`. Loader-provided memory decisions and phase timings may also be present in
`loadDiagnostics`.

Node queries require the corresponding capability. All-node bbox and radius methods require `"all"`, while
`findTaggedIndexesWithinBbox` requires `"tagged"`. A missing capability throws
`SpatialIndexNotBuiltError`; queries never return an artificial empty result or build a large index
synchronously.

Typed-buffer allocation failures expose structured diagnostics. `TypedBufferAllocationError` reports the
operation, typed-array and buffer types, element count, element width, and required bytes.
`OsmEntityIndexBuildError` adds the entity type and the failing `ids`, `tags`, or entity-data component while
preserving the allocation error as its cause. Worker clients can use these fields to distinguish a mandatory
core-storage limit from an optional spatial-index failure.

## Environment and Limitations

- Requires Web Streams, `TextEncoder`/`TextDecoder`, `CompressionStream`/`DecompressionStream` (Bun, Node 20+, modern browsers).
- Uses ES2024 resizable `ArrayBuffer` and growable `SharedArrayBuffer` when available.
- Every individual typed-array column must still fit in one fixed buffer when entity indexes are finalized.
- Coordinates stored as `Int32Array` microdegrees (1e-7 degree precision, ~1cm at equator); converted to degrees at API boundaries.
- Algorithms that need arbitrary untagged-node lookup require the all-node spatial capability. Build it
  explicitly or load with the Full profile from `@osmix/load`.

## Related Packages

- [`osmix`](../osmix/README.md) — High-level API for loading PBF files and worker orchestration.
- [`@osmix/load`](../load/README.md) — PBF loading, geographic extracts, and export into `Osm` indexes.
- [`@osmix/pbf`](../pbf/README.md) — Low-level PBF parsing and serialization.
- [`@osmix/json`](../json/README.md) — JSON entity conversion.
- [`@osmix/geojson`](../geojson/README.md) — Convert entities to GeoJSON features.
- [`@osmix/change`](../change/README.md) — Changeset generation, deduplication, and merge.

## Development

```sh
pnpm run test packages/core
pnpm run typecheck packages/core
pnpm run lint packages/core
```

Run `pnpm run check` at the repo root before publishing.

## Test helpers

Mock OSM datasets for tests are available via a separate entrypoint (not re-exported from the main package):

```ts check-docs
import { createMockBaseOsm, createMockPatchOsm } from "@osmix/core/mocks";

const base = createMockBaseOsm();
const patch = createMockPatchOsm();
console.log(base.id, patch.id);
```
