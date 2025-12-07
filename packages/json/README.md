# @osmix/json

Convert OpenStreetMap PBF bytes to ergonomic JSON entities (and back again) for streaming editors, change workflows, and browser-based tooling. Builds on [`@osmix/pbf`](../pbf/README.md) primitives while staying friendly to modern runtimes.

## Highlights

- **Decode** `.osm.pbf` streams into header metadata and strongly typed node/way/relation JSON.
- **Encode** JSON entities back into spec-compliant PBF blobs with automatic string tables and delta encoding.
- **Stream** using Web Stream transforms to keep large datasets out of memory.
- **Compose** with other Osmix packages for complete read-modify-write workflows.

## Installation

```sh
bun add @osmix/json
```

## Usage

### Decode a PBF stream

```ts
import { osmPbfToJson } from "@osmix/json"
import { toAsyncGenerator } from "@osmix/pbf"

const stream = osmPbfToJson(Bun.file('./monaco.pbf').stream())

for await (const item of toAsyncGenerator(stream)) {
	if ("id" in item) {
		// item is OsmNode | OsmWay | OsmRelation
		console.log(item.id, item.tags?.name)
	} else {
		// item is OsmPbfHeaderBlock
		console.log("Features:", item.required_features)
	}
}
```

### Encode JSON to PBF

```ts
import { osmJsonToPbf } from "@osmix/json"

// Create header
const header = {
	required_features: ["OsmSchema-V0.6", "DenseNodes"],
	optional_features: [],
}

// Create entity generator
async function* generateEntities() {
	yield { id: 1, lon: -122.4, lat: 47.6, tags: { name: "Seattle" } }
	yield { id: 2, lon: -122.3, lat: 47.5 }
	yield { id: 10, refs: [1, 2], tags: { highway: "primary" } }
}

// Convert to PBF stream
const pbfStream = osmJsonToPbf(header, generateEntities())
await Bun.write('./output.pbf', pbfStream)
```

### Using TransformStreams

```ts
import {
	OsmBlocksToJsonTransformStream,
	OsmJsonToBlocksTransformStream,
} from "@osmix/json"
import {
	OsmPbfBytesToBlocksTransformStream,
	OsmBlocksToPbfBytesTransformStream,
} from "@osmix/pbf"

// Decode: bytes → blocks → JSON entities
const jsonStream = pbfBytes
	.pipeThrough(new OsmPbfBytesToBlocksTransformStream())
	.pipeThrough(new OsmBlocksToJsonTransformStream())

// Encode: JSON entities → blocks → bytes
const pbfStream = entityStream
	.pipeThrough(new OsmJsonToBlocksTransformStream())
	.pipeThrough(new OsmBlocksToPbfBytesTransformStream())
```

## API

### Decoding (PBF → JSON)

| Export | Description |
|--------|-------------|
| `osmPbfToJson(stream)` | Convert PBF bytes to stream of header + JSON entities |
| `OsmBlocksToJsonTransformStream` | TransformStream: primitive blocks → JSON entities |
| `blocksToJsonEntities(block)` | Generator: extract entities from a single block |
| `OsmPbfBlockParser` | Class for parsing blocks with configurable options |

### Encoding (JSON → PBF)

| Export | Description |
|--------|-------------|
| `osmJsonToPbf(header, entities)` | Convert header + entities to PBF byte stream |
| `OsmJsonToBlocksTransformStream` | TransformStream: JSON entities → primitive blocks |
| `jsonEntitiesToBlocks(entities)` | Async generator: entities → blocks |
| `OsmPbfBlockBuilder` | Class for building blocks from entities |

### Types

| Export | Description |
|--------|-------------|
| `ParseOptions` | Options for `OsmPbfBlockParser` (parseTags, includeInfo) |
| `OSM_ENTITY_TYPES` | Array: `["node", "way", "relation"]` |

## Related Packages

- [`@osmix/pbf`](../pbf/README.md) – Low-level block readers and writers used here.
- [`@osmix/core`](../core/README.md) – In-memory index that consumes these JSON entities.
- [`@osmix/change`](../change/README.md) – Dedupe and merge workflows.
- [`@osmix/geojson`](../geojson/README.md) – Convert JSON entities to GeoJSON.

## Environment and Limitations

- Requires Web Streams, `TextEncoder`/`TextDecoder` (Bun, Node 20+, modern browsers).
- Expects zlib-compressed blobs; other compression formats are not supported.
- JSON → PBF pipelines assume sorted entities (nodes, then ways, then relations).

## Development

```sh
bun run test packages/json
bun run lint packages/json
bun run typecheck packages/json
```

Run `bun run check` at the repo root before publishing.
