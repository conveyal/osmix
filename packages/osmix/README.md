# osmix

`osmix` is the high-level entrypoint for the Osmix toolkit. It layers ingestion,
streaming, and worker orchestration utilities on top of the low-level
`@osmix/core` index so you can load `.osm.pbf` files, convert GeoJSON, and
request raster/vector tiles with a single import.

## Highlights

- `Osmix.fromPbf` parses streams, `ArrayBuffer`s, or `ReadableStream`s into a
  ready-to-query `Osmix` instance with throttled progress callbacks.
- `OsmixRemote` mirrors the same API on top of Comlink workers so large datasets
  can be ingested and merged without blocking the main thread.
- Export helpers to create extracts, convert back to `.osm.pbf`, or stream
  entities through `ReadableStream`s.
- Hook directly into raster (`getRasterTile`) and vector (`getVectorTile`)
  rendering without recreating projections or tile math.

## Installation

```sh
npm install osmix
```

## Usage

### Load a PBF and inspect it

```ts
import { Osmix } from "osmix"

const osm = await Osmix.fromPbf(Bun.file("monaco.osm.pbf").stream())

console.log(osm.nodes.size, osm.ways.size, osm.relations.size)
const tileBytes = await osm.getVectorTile([9372, 12535, 15])
```

`Osmix.fromPbf` accepts `ArrayBufferLike`, Node/Bun readable streams, Web
`ReadableStream`s, or `Uint8Array`s. Pass an `onProgress` callback (defaults to
`logProgress`) if you want status updates during ingest.

### Convert GeoJSON into an Osm dataset

```ts
import { Osmix } from "osmix"

const file = await fetch("/fixtures/buildings.geojson").then((r) => r.arrayBuffer())
const osm = await Osmix.fromGeoJSON(file)
const pbfBytes = await osm.toPbf()
// Write to file: await Bun.write("buildings.osm.pbf", pbfBytes)
```

`fromGeoJSON` reuses nodes when coordinates repeat, creates relations for
polygons with holes, and calls `buildIndexes()`/`buildSpatialIndexes()` before
returning so the dataset is immediately queryable.

### Stream work across workers with `OsmixRemote`

```ts
import { OsmixRemote } from "osmix"

const remote = await OsmixRemote.connect()
const info = await remote.fromPbf(Bun.file("./monaco.pbf").stream())
const patchInfo = await remote.fromPbf(Bun.file("patch.osm.pbf").stream(), {
	id: "patch",
})
await remote.merge(info.id, patchInfo.id)
const rasterTile = await remote.getRasterTile(info.id, [10561, 22891, 16])
```

`OsmixRemote` automatically transfers typed arrays across workers (using
`SharedArrayBuffer` when available) and exposes the same helpers as a local
`Osmix` instance: `fromPbf`, `fromGeoJSON`, `getVectorTile`, `getRasterTile`,
`search`, `merge`, `generateChangeset`, etc. Use `collectTransferables` +
`transfer` when you need to post Osmix payloads through your own worker setup.

### Extract, stream, and write back to PBF

```ts
import { Osmix } from "osmix"

const osm = await Osmix.fromPbf(Bun.file('./monaco.pbf').stream())
const downtown = await osm.extract([-122.35, 47.60, -122.32, 47.62])
await downtown.toPbfStream().pipeTo(fileWritableStream)
```

`createExtract` can either clip ways/members to the bbox (`strategy: "simple"`)
or include complete ways/relations. `osmToPbfStream` and `osmToPbfBuffer`
reuse the streaming builders from `@osmix/json`/`@osmix/pbf`, so outputs stay
spec-compliant without staging everything in memory.

## Environment and limitations

- Requires runtimes that expose Web Streams plus modern typed array + compression
  APIs (Node 20+, Bun, current browsers). `OsmixRemote` also requires `Worker`
  support and, for multi-worker concurrency, `SharedArrayBuffer`.
- `createOsmFromPbf` expects dense-node blocks; sparse node encodings are not yet
  supported.
- Raster helpers rely on `OffscreenCanvas` + `ImageData`. In Node, Bun 1.1+ is
  recommended so the runtime provides those globals.

## Development

- `bun run test packages/osmix`
- `bun run lint packages/osmix`
- `bun run typecheck packages/osmix`

Run `bun run check` from the repo root before publishing to keep formatting,
lint, and types consistent.

