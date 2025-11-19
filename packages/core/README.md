# @osmix/core

@osmix/core exposes the `Osm` index: a typed-array OpenStreetMap engine that reads `.osm.pbf` streams, builds spatial indexes, and emits JSON, PBF, or raster tiles without leaving modern JavaScript runtimes.

## Highlights

- Ingest `.osm.pbf` sources into node, way, and relation stores backed by transferable typed arrays using readers from [`@osmix/pbf`](../pbf/README.md).
- Coordinates stored as `Int32Array` microdegrees (1e-7 degree precision) for efficient memory usage; conversion to degrees happens at API boundaries.
- Run fast bounding-box searches with KDBush/Flatbush (also using `Int32Array` microdegrees) and convert matches straight to GeoJSON.
- Trim extracts, write new PBF buffers, or stream entities to downstream tooling with [`@osmix/json`](../json/README.md) or [`@osmix/pbf`](../pbf/README.md).
- Pair with [`@osmix/change`](../change/README.md) when you need deduplication, intersection, or merge pipelines.
- Ship fully indexed datasets across workers via `transferables()` + `new Osm(transferables)`.

## Installation

```sh
npm install @osmix/core
```

## Usage

### Load a PBF into an `Osm` index

`@osmix/core` focuses on the in-memory data structure itself; higher-level
ingest helpers live in the top-level `osmix` package. Use
`createOsmFromPbf`/`startCreateOsmFromPbf` to parse `.osm.pbf` input and
receive an `Osm` instance.

```ts
import { createOsmFromPbf } from "osmix"

const osm = await createOsmFromPbf(Bun.file("example.osm.pbf").stream(), {
	id: "example",
	extractBbox: [-122.5, 47.45, -122.2, 47.75],
})

console.log(osm.nodes.size, osm.ways.size, osm.relations.size)
```

Need incremental status updates? Switch to `startCreateOsmFromPbf` and consume
its `ProgressEvent`s before the final `Osm` value.

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

### Extract and emit data

Use the helpers from `osmix` when you want to clip datasets or write them back
to `.osm.pbf`.

```ts
import { createExtract, osmToPbfStream } from "osmix"

const downtown = createExtract(osm, [-122.35, 47.60, -122.32, 47.62])
await osmToPbfStream(downtown).pipeTo(fileWritableStream)
```

`createExtract` keeps indexes intact and recomputes the header bbox. If you only
need to ship datasets between workers, call `osm.transferables()` and post the
result—every nested typed array is already laid out for structured cloning.

## API overview

- `Osm` – ingest PBF sources, build indexes, query entities, extract subsets, emit JSON/PBF, and transfer typed arrays.
- `Nodes` / `Ways` / `Relations` – typed-array backed stores exposed for advanced workflows (direct coordinate access, bbox searches, ref rewrites).

## Environment and limitations

- Requires runtimes with Web Streams, `TextEncoder`/`TextDecoder`, and zlib-compatible `CompressionStream`/`DecompressionStream` support (Bun, Node 20+, modern browsers).
- `createOsmFromPbf` (from `osmix`) expects dense-node blocks; PBFs that omit dense encodings are currently unsupported.
- Filtering during ingest depends on node membership; emit nodes, then ways, then relations when supplying custom entity generators.

## Development

- `bun run test packages/core`
- `bun run lint packages/core`
- `bun run typecheck packages/core`

Run `bun run check` at the repo root before publishing to ensure formatting, lint, and type coverage.
