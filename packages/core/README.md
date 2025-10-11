# @osmix/core

`@osmix/core` exposes the `Osmix` index, a high-performance OpenStreetMap (OSM) PBF reader,
writer, and spatial query engine built on typed arrays. It is designed to make it easy and fast to work with PBFs in modern JavaScript applications. As a library, it can also be embedded in your own tooling to read PBF blobs, extract cutouts, mutate data, and write the results back to disk or the network.

- Stream PBF data directly into indexed node, way, and relation stores.
- Build spatial indexes for fast bounding box searches and feature extraction.
- Convert entities to GeoJSON features or new PBF files.
- Create changesets and raster tiles anchored to the indexed data.
- Typed array-backed indexes stay transferable, so you can build them in workers
  and hand results back to the main thread without re-parsing.

## Installation

Add the package to your project:

```bash
npm i @osmix/core
```

Inside this workspace, `bun install` already wires the package for local development.

## Quick start

```ts
import { Osmix } from "@osmix/core"
import { readFile } from "node:fs/promises"

const osm = await Osmix.fromPbf(readFile("example.osm.pbf"))

console.log(osm.nodes.size, osm.ways.size, osm.relations.size)
```

The reader builds all
entity and spatial indexes before resolving, so the instance is ready for queries immediately.

## Loading data

### Streaming a PBF

If you need progress updates while streaming, create the instance manually and listen for log
events:

```ts
import { Osmix, type OsmixLogEvent } from "@osmix/core"
import { createReadStream } from "node:fs"

const osm = new Osmix()
osm.addEventListener("log", (event: OsmixLogEvent) => {
	console.log(`[${event.detail.type}] ${event.detail.message}`)
})

await osm.readPbf(createReadStream("seattle.osm.pbf"))
```

`readPbf` keeps the raw header (including declared bounds) and builds the entity indexes when the
stream completes. To limit the ingest to a smaller region during parsing, provide `extractBbox`:

```ts
await osm.readPbf(createReadStream("planet.osm.pbf"), {
	extractBbox: [-122.5, 47.45, -122.2, 47.75], // [minLon, minLat, maxLon, maxLat]
})
```

`Osmix.fromPbf`/`osmix.readPbf` accept a `ArrayBufferLike`, a `ReadableStream<ArrayBufferLike>`, an `AsyncGenerator<ArrayBufferLike>` or a `Promise<>` that resolves to one of those. 

### Manual construction

You can add entities directly when constructing synthetic fixtures. Remember to call `buildIndexes`
before making queries:

```ts
const osm = new Osmix()
osm.nodes.addNode({ id: 1, lon: -0.1, lat: 51.5, tags: { amenity: "cafe" } })
osm.ways.addWay({ id: 10, refs: [1], tags: { highway: "service" } })
osm.buildIndexes()
```

## Querying the index

The `Nodes`, `Ways`, and `Relations` stores expose low-level helpers, while `Osmix` supplies typed
wrappers for common tasks.

- `osm.get("node", 123)` or `osm.getById("n123")` fetches a single entity.
- `osm.nodes.sorted()` yields nodes in ascending ID order.
- `osm.getEntityGeoJson(entity)` converts any entity to a GeoJSON feature using the indexed
  geometries.

Spatial lookups rely on the pre-built KDBush/Flatbush indexes:

```ts
const bbox = [-122.34, 47.57, -122.30, 47.61]
const { ids, positions } = osm.getNodesInBbox(bbox)

const { ids: wayIds, positions: wayCoords, startIndices } = osm.getWaysInBbox(bbox)
```

`positions` contains packed `[lon, lat]` pairs as `Float64Array`s. `startIndices` lets you slice
`wayCoords` back into per-way geometries.

To compute bounds for a specific entity (including relations), use:

```ts
const relation = osm.relations.getById(42)
const relationBbox = relation ? osm.getEntityBbox(relation) : undefined
```

## Extracting subsets

`Osmix.extract` clones the current index and keeps only features that intersect
the supplied bounding box, trimming way members and relation membership along
the way:

```ts
const downtown = osm.extract([-122.35, 47.60, -122.32, 47.62], console.log)
console.log(downtown.nodes.size, downtown.ways.size)
```

The extractor produces a fully indexed `Osmix` instance that you can serialize or
continue to edit.

## Writing PBF output

`Osmix` can emit JSON entities or full PBF blocks:

```ts
// As a readable stream of nodes/ways/relations
const entityStream = osm.toEntityStream()

// As raw PBF bytes
const pbfStream = osm.toPbfStream()
const pbfBuffer = await osm.toPbfBuffer()
```

These helpers preserve the original PBF header and populate the `writingprogram` metadata with
`@osmix/core`.

## Changesets and editing

- `osm.createChangeset()` initializes the merge helper, which can deduplicate
  nodes, stitch ways, and build OSC changes compatible with OSM editors.

Refer to `src/changeset.ts` for the full set of editing utilities; they all operate
against the `Osmix` instance you pass in.

## Raster tiles

`osm.createRasterTile(bbox, tileIndex, tileSize)` returns an `OsmixRasterTile` bound to the current
index. The tile shares the node and way caches, so spatial queries stay fast without duplicating
data.

## Moving data between threads

Use `osm.transferables()` to serialize the index into transferable `ArrayBuffer`s,
then rebuild it in a worker without re-reading the original PBF:

```ts
// main thread
const payload = osm.transferables()
worker.postMessage(payload, {
	transfer: collectArrayBuffers(payload),
})

function collectArrayBuffers(
	value: unknown,
	buffers: ArrayBuffer[] = [],
): ArrayBuffer[] {
	if (value == null) return buffers
	if (value instanceof ArrayBuffer) {
		buffers.push(value)
		return buffers
	}
	if (ArrayBuffer.isView(value)) {
		buffers.push(value.buffer)
		return buffers
	}
	if (Array.isArray(value)) {
		for (const item of value) collectArrayBuffers(item, buffers)
		return buffers
	}
	if (typeof value === "object") {
		for (const item of Object.values(value))
			collectArrayBuffers(item, buffers)
	}
	return buffers
}

// worker
import { Osmix } from "@osmix/core"

self.addEventListener("message", ({ data }) => {
	const osm = Osmix.from(data)
})
```

`Osmix.from` mirrors the constructor used in the reader, restoring the string table
and entity indexes so the worker can immediately serve queries.

Typed arrays back every numeric store (IDs, coordinates, indexes), so the entire
structure can be built off the main thread inside a `Worker` without extra
serialization. When you call `transferables()`, the backed `ArrayBuffer`s move
between threads with zero copy, letting you parse or merge large PBFs in the
background and ship a ready-to-query index back to the UI thread.

## Logging

Every call to `osm.log(message, level)` dispatches an `OsmixLogEvent`. Use
`osm.createThrottledLog(intervalMs)` to instrument long-running operations without flooding the log:

```ts
const logEverySecond = osm.createThrottledLog(1_000)
logEverySecond("Still parsing…")
```

## Performance notes

- `readPbf` calls `buildIndexes()` for you. If you mutate entities manually, invoke `buildIndexes`
  once before issuing spatial queries.
- Typed arrays back the ID and geometry stores. Prefer using the exposed helpers (`withinBbox`,
  `getLine`, `sorted`, etc.) instead of reading internal arrays directly.
- Bounding box extraction works best when paired with streaming reads. Use `extractBbox` to stop
  irrelevant data from entering the index in the first place.

## Further reading

- `src/osmix.ts` — core implementation.
- `src/nodes.ts`, `src/ways.ts`, `src/relations.ts` — entity indexes used by `Osmix`.
- `test/*.test.ts` — practical examples of reading, extracting, merging, and writing.
