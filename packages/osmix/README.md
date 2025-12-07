# osmix

`osmix` is the high-level entrypoint for the Osmix toolkit. It layers ingestion,
streaming, and worker orchestration utilities on top of the low-level
`@osmix/core` index so you can load `.osm.pbf` files, convert GeoJSON, and
request raster/vector tiles with a single import.

## Installation

```sh
bun install osmix
```

## Usage

### Load a PBF and inspect it

```ts
import * as Osmix from "osmix"

const monacoPbf = await Bun.file("./monaco.pbf").arrayBuffer() 
const osm = = await Osmix.fromPbf(monacoPbf)

console.log(osm.nodes.size, osm.ways.size, osm.relations.size)
const tileBytes = await osm.getVectorTile([9372, 12535, 15])

const geojsonFile = await fetch("/fixtures/buildings.geojson").then((r) => r.arrayBuffer())
const osm = await Osmix.fromGeoJSON(geojsonFile)
const pbfBytes = await Osmix.toPbfBuffer(osm)
```

### Work off the main thread with `OsmixRemote`

```ts
const remote = await Osmix.createRemote()
const monacoOsmInfo = await remote.fromPbf(monacoPbf)
const patchOsmInfo = await remote.fromPbf(Bun.file("patch.osm.pbf").stream(), {
	id: "patch",
})
await remote.merge(monacoOsmInfo, patchOsmInfo)
const rasterTile = await remote.getRasterTile(monacoOsmInfo, [10561, 22891, 16])
```

#### How?

`OsmixRemote` automatically transfers typed arrays across workers (using
`SharedArrayBuffer` when available) and exposes the same helpers exposed in the main import: `fromPbf`, `fromGeoJSON`, `getVectorTile`, `getRasterTile`,
`search`, `merge`, `generateChangeset`, etc. Use `collectTransferables` +
`transfer` when you need to post Osmix payloads through your own worker setup.

### Extract, stream, and write back to PBF

```ts
const osm = await Osmix.fromPbf(Bun.file('./monaco.pbf').stream())
const downtown = await Osmix.createExtract(osm, [-122.35, 47.60, -122.32, 47.62])
await Osmix.toPbfStream(downtown).pipeTo(fileWritableStream)
```

`createExtract` can either clip ways/members to the bbox (`strategy: "simple"`)
or include complete ways/relations. `toPbfStream` and `toPbfBuffer`
reuse the streaming builders from `@osmix/json`/`@osmix/pbf`, so outputs stay
spec-compliant without staging everything in memory.

## API

WIP

## Environment and limitations

- Requires runtimes that expose Web Streams plus modern typed array + compression
  APIs (Node 20+, Bun, current browsers). `OsmixRemote` also requires `Worker`
  support and, for multi-worker concurrency, `SharedArrayBuffer`.
- `fromPbf` expects dense-node blocks; sparse node encodings are not yet supported.
- Raster helpers rely on `OffscreenCanvas` + `ImageData`.

## Development

- `bun run test packages/osmix`
- `bun run lint packages/osmix`
- `bun run typecheck packages/osmix`

Run `bun run check` from the repo root before publishing to keep formatting,
lint, and types consistent.

