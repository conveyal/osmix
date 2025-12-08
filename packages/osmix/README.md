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
import { fromPbf, fromGeoJSON, toPbfBuffer } from "osmix"

const monacoPbf = await Bun.file("./monaco.pbf").arrayBuffer()
const osm = await fromPbf(monacoPbf)

console.log(osm.nodes.size, osm.ways.size, osm.relations.size)

const geojsonFile = await fetch("/fixtures/buildings.geojson").then((r) => r.arrayBuffer())
const geoOsm = await fromGeoJSON(geojsonFile)
const pbfBytes = await toPbfBuffer(geoOsm)
```

### Work off the main thread with `OsmixRemote`

```ts
import { createRemote } from "osmix"

const remote = await createRemote()
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

### Routing with workers

`OsmixRemote` provides off-thread routing via `@osmix/router`. The routing graph
builds lazily on first use, so there's no upfront cost until you actually route.

```ts
import { createRemote } from "osmix"

const remote = await createRemote()
const osmInfo = await remote.fromPbf(monacoPbf)

// Find nearest routable nodes to coordinates
const from = await remote.findNearestRoutableNode(osmInfo.id, [7.42, 43.73], 0.5)
const to = await remote.findNearestRoutableNode(osmInfo.id, [7.43, 43.74], 0.5)

if (from && to) {
	// Calculate route with statistics and path info
	const result = await remote.route(osmInfo.id, from.nodeIndex, to.nodeIndex, {
		includeStats: true,
		includePathInfo: true,
	})

	if (result) {
		console.log(result.coordinates) // Route geometry
		console.log(result.distance) // Distance in meters
		console.log(result.time) // Time in seconds
		console.log(result.segments) // Per-way breakdown
	}
}
```

The routing graph is automatically shared across all workers when using
`SharedArrayBuffer`, so any worker can handle routing requests.

### Extract, stream, and write back to PBF

```ts
import { fromPbf, createExtract, toPbfStream } from "osmix"

const osm = await fromPbf(Bun.file('./monaco.pbf').stream())
const downtown = createExtract(osm, [-122.35, 47.60, -122.32, 47.62])
await toPbfStream(downtown).pipeTo(fileWritableStream)
```

`createExtract` can either clip ways/members to the bbox (`strategy: "simple"`)
or include complete ways/relations. `toPbfStream` and `toPbfBuffer`
reuse the streaming builders from `@osmix/json`/`@osmix/pbf`, so outputs stay
spec-compliant without staging everything in memory.

## API

### Loading

- `fromPbf(data, options?)` - Load OSM data from PBF (buffer, stream, or File).
- `fromGeoJSON(data, options?)` - Load OSM data from GeoJSON.
- `readOsmPbfHeader(data)` - Read only the PBF header without loading entities.

### Export

- `toPbfStream(osm)` - Stream Osm to PBF bytes (memory-efficient).
- `toPbfBuffer(osm)` - Convert Osm to a single PBF buffer.

### Extraction

- `createExtract(osm, bbox, strategy?)` - Create geographic extract.
  - `"simple"` - Strict spatial cut.
  - `"complete_ways"` - Include complete way geometry.
  - `"smart"` - Complete ways + resolved multipolygons.

### Tiles

- `drawToRasterTile(osm, tile, tileSize?)` - Render Osm to raster tile.

### Workers (OsmixRemote)

- `createRemote(options?)` - Create worker pool manager.
- `remote.fromPbf(data, options?)` - Load in worker.
- `remote.fromGeoJSON(data, options?)` - Load in worker.
- `remote.getVectorTile(osmId, tile)` - Generate MVT in worker.
- `remote.getRasterTile(osmId, tile, tileSize?)` - Generate raster in worker.
- `remote.merge(baseId, patchId, options?)` - Merge datasets in worker.
- `remote.search(osmId, key, val?)` - Search by tag.
- `remote.toPbf(osmId, stream)` - Export to PBF.

#### Routing

- `remote.buildRoutingGraph(osmId, filter?, speeds?)` - Explicitly build routing graph (optional, builds lazily on first use).
- `remote.hasRoutingGraph(osmId)` - Check if routing graph exists.
- `remote.findNearestRoutableNode(osmId, point, maxKm)` - Snap coordinate to nearest routable node.
- `remote.route(osmId, fromIndex, toIndex, options?)` - Calculate route between nodes.
  - `options.includeStats` - Include `distance` and `time` in result.
  - `options.includePathInfo` - Include `segments` and `turnPoints` in result.

### Utilities

- `collectTransferables(value)` - Find transferable buffers in nested objects.
- `transfer(data)` - Wrap data for zero-copy worker transfer.

## Related Packages

- [`@osmix/core`](../core/README.md) - In-memory OSM index with typed arrays and spatial queries.
- [`@osmix/pbf`](../pbf/README.md) - Low-level PBF reading and writing.
- [`@osmix/json`](../json/README.md) - PBF to JSON entity conversion.
- [`@osmix/geojson`](../geojson/README.md) - GeoJSON import/export.
- [`@osmix/change`](../change/README.md) - Changeset management and merge workflows.
- [`@osmix/raster`](../raster/README.md) - Raster tile rendering.
- [`@osmix/vt`](../vt/README.md) - Vector tile encoding.
- [`@osmix/router`](../router/README.md) - Pathfinding on OSM road networks.
- [`@osmix/shared`](../shared/README.md) - Shared utilities and types.

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
