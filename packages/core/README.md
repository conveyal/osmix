# @osmix/core

@osmix/core exposes the `Osm` index which efficently stores OSM entities, creates spatial indexes, and handles spatial queries and tag searches.

## Highlights


- Run fast bounding-box searches with KDBush/Flatbush (also using `Int32Array` microdegrees) and convert matches straight to GeoJSON.
- Trim extracts, write new PBF buffers, or stream entities to downstream tooling with [`@osmix/json`](../json/README.md) or [`@osmix/pbf`](../pbf/README.md).
- Pair with [`@osmix/change`](../change/README.md) when you need deduplication, intersection, or merge pipelines.
- Ship fully indexed datasets across workers via `transferables()` + `new Osm(transferables)`.

## Installation

```sh
bun install @osmix/core
```

## Usage

### Load a PBF into an `Osm` index

`@osmix/core` focuses on the in-memory data structure itself; higher-level
ingest helpers live in the top-level `osmix` package. If you don't need the other `Osmix` utilities, use
`createOsmFromPbf` directly to parse `.osm.pbf` input and
receive an `Osm` instance.

```ts
import { createOsmFromPbf } from "osmix"

const osm = await createOsmFromPbf(Bun.file("./monaco.pbf").stream())
console.log(osm.nodes.size, osm.ways.size, osm.relations.size)
```

### Build fixtures directly

When generating synthetic data, instantiate `Osm` yourself, add entities, and
call `buildIndexes()`/`buildSpatialIndexes()` before issuing queries.

```ts
import { Osm } from "@osmix/core"

const osm = new Osm({ id: "fixture" })
osm.nodes.addNode({
	id: 1,
	lon: -0.1,
	lat: 51.5,
	tags: { amenity: "cafe" },
})
osm.ways.addWay({ id: 10, refs: [1], tags: { highway: "service" } })
osm.buildIndexes()
osm.buildSpatialIndexes()
```

### Query and iterate

- `osm.nodes.get({ id: 123 })` or `osm.nodes.getById(123)` fetches specific
  entities.
- `osm.nodes.sorted()` / `osm.ways.sorted()` stream entities in ascending ID order.
- `osm.nodes.withinBbox(bbox)` / `osm.ways.withinBbox(bbox)` emit
  typed arrays ready to transfer across workers.
- Pair with [`@osmix/geojson`](../geojson/README.md) when you need GeoJSON
  features: `osmEntityToGeoJSONFeature(osm, entity)`.

```ts
const bbox: [number, number, number, number] = [-122.34, 47.57, -122.30, 47.61]
const { ids, positions } = osm.nodes.withinBbox(bbox)
const { ids: wayIds, positions: wayCoords, startIndices } = osm.ways.withinBbox(
	bbox,
)
```

`positions` stores `[lon, lat]` pairs; `startIndices` splits `wayCoords` into
per-way sequences that rendering layers (Deck.gl, WebGL instancing, etc.) can
consume directly.

## API

WIP

## Environment and limitations

- Requires runtimes with Web Streams, `TextEncoder`/`TextDecoder`, and zlib-compatible `CompressionStream`/`DecompressionStream` support (Bun, Node 20+, modern browsers).
- Coordinates stored as `Int32Array` microdegrees (1e-7 degree precision) for efficient memory usage; conversion to degrees happens at API boundaries.

## Development

- `bun run test packages/core`
- `bun run lint packages/core`
- `bun run typecheck packages/core`

Run `bun run check` at the repo root before publishing to ensure formatting, lint, and type coverage.
