# @osmix/core

@osmix/core wraps the `Osmix` index: a typed-array OpenStreetMap engine that reads `.osm.pbf` streams, builds spatial indexes, and emits JSON, PBF, or raster tiles without leaving modern JavaScript runtimes.

## Highlights

- Ingest `.osm.pbf` sources into node, way, and relation stores backed by transferable typed arrays using readers from [`@osmix/pbf`](../pbf/README.md).
- Run fast bounding-box searches with KDBush/Flatbush and convert matches straight to GeoJSON.
- Trim extracts, write new PBF buffers, or stream entities to downstream tooling with [`@osmix/json`](../json/README.md) or [`@osmix/pbf`](../pbf/README.md).
- Pair with [`@osmix/change`](../change/README.md) when you need deduplication, intersection, or merge pipelines.
- Ship fully indexed datasets across workers via `transferables()` + `Osmix.from`.

## Installation

```sh
npm install @osmix/core
```

## Usage

### Load a PBF in one call

```ts
import { osmixFromPbf } from "@osmix/core"
import { readFile } from "node:fs/promises"

const osm = await osmixFromPbf(readFile("example.osm.pbf"))

console.log(osm.nodes.size, osm.ways.size, osm.relations.size)
```

`osmixFromPbf` accepts `ArrayBufferLike`, async (iterable) chunks, or Web `ReadableStream` inputs.

### Stream with progress and extraction

Pass a logger or set one later to receive throttled progress messages. Provide `extractBbox` to keep only features intersecting the desired bounds while parsing.

```ts
import { osmixFromPbf } from "@osmix/core"
import { createReadStream } from "node:fs"

await osmixFromPbf(createReadStream("planet.osm.pbf"), {
	extractBbox: [-122.5, 47.45, -122.2, 47.75],
	logger: (msg) => console.log(msg)
})
```

### Build synthetic fixtures

When generating test data, insert entities directly and call `buildIndexes()` before querying.

```ts
const osm = new Osmix({ id: "fixture" })
osm.nodes.addNode({ id: 1, lon: -0.1, lat: 51.5, tags: { amenity: "cafe" } })
osm.ways.addWay({ id: 10, refs: [1], tags: { highway: "service" } })
osm.buildIndexes()
```

## Query the index

- `osm.get("node", 123)` or `osm.getById("n123")` fetches specific entities.
- `osm.nodes.sorted()` / `osm.ways.sorted()` iterate ids in ascending order.
- `osmixEntityToGeoJSONFeature(osm, entity)` returns a GeoJSON feature with coordinates resolved from the
  indexed nodes.

Spatial lookups emit compact typed arrays that can be transferred across Web Workers and used directly in `Deck.gl`:

```ts
const bbox = [-122.34, 47.57, -122.30, 47.61]
const { ids, positions } = osm.nodes.withinBbox(bbox)

const { ids: wayIds, positions: wayCoords, startIndices } = osm.ways.withinBbox(bbox)
```

`positions` stores `[lon, lat]` pairs; `startIndices` splits `wayCoords` into per-way sequences.

## Extract and export data

```ts
const downtown = osm.extract([-122.35, 47.60, -122.32, 47.62])

const entityStream = osmixToReadableStream(downtown) // header + entities
const pbfStream = osmixToPbfStream(downtown) // Uint8Array chunks
const pbfBuffer = osmixToPbfBuffer(downtown)
```

`extract` returns a new, fully indexed `Osmix` instance with the header bbox updated.

## Changesets and merging

Change orchestration now lives in the dedicated [`@osmix/change`](../change/README.md) package. Install it alongside
`@osmix/core` when you want to deduplicate entities, generate direct merges, or script intersection creation:

```ts
import { Osmix } from "@osmix/core"
import { merge, OsmixChangeset } from "@osmix/change"
import { readFile } from "node:fs/promises"

const base = await osmixFromPbf(readFile("base.osm.pbf"))
const patch = await osmixFromPbf(readFile("patch.osm.pbf"))

const changeset = new OsmixChangeset(base)
changeset.deduplicateWays(base.ways)

const merged = await merge(base, patch, { directMerge: true })
```

Refer to the [`@osmix/change` README](../change/README.md) for the full API surface.

## Transfer between threads

Typed arrays keep the index transferable.

```ts
// main thread
const payload = osm.transferables()
const buffers = []
const collect = (value: unknown) => {
	if (value instanceof ArrayBuffer) buffers.push(value)
	else if (ArrayBuffer.isView(value)) buffers.push(value.buffer)
	else if (Array.isArray(value)) value.forEach(collect)
	else if (value && typeof value === "object")
		Object.values(value).forEach(collect)
	return buffers
}

worker.postMessage(payload, { transfer: collect(payload) })

// worker
import { Osmix } from "@osmix/core"

self.addEventListener("message", ({ data }) => {
	const osm = new Osmix(data)
	// ready for queries immediately
})
```

## API overview

- `Osmix` – ingest PBF sources, build indexes, query entities, extract subsets, and emit JSON/PBF.
- `Nodes` / `Ways` / `Relations` – typed-array backed stores exposed for advanced workflows.

## Environment and limitations

- Requires runtimes with Web Streams, `TextEncoder`/`TextDecoder`, and zlib-compatible `CompressionStream`/`DecompressionStream` support (Bun, Node 20+, modern browsers).
- `osmixFromPbf` expects dense-node blocks; PBFs that omit dense encodings are currently unsupported.
- Filtering during ingest depends on node membership; emit nodes, then ways, then relations when supplying custom entity generators.

## Development

- `bun run test packages/core`
- `bun run lint packages/core`
- `bun run typecheck packages/core`

Run `bun run check` at the repo root before publishing to ensure formatting, lint, and type coverage.
