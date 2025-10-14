# @osmix/json

@osmix/json turns OpenStreetMap PBF bytes into ergonomic JSON entities (and back again) for streaming editors, change workflows, and browser-based tooling. It builds on the low-level primitives in [`@osmix/pbf`](../pbf/README.md) while staying friendly to modern runtimes (Node 20+, and modern browsers).

## Highlights

- Decode `.osm.pbf` streams into header metadata and strongly typed node/way/relation JSON.
- Encode JSON entities back into spec-compliant PBF blobs without hand-rolling string tables or delta encoding.
- Compose Web Stream transforms to keep large datasets out of memory and re-use work across workers or service boundaries.
- Opt into metadata parsing or emission (`timestamp`, `uid`, etc.) only when you need it.
- Convert entities to GeoJSON with `wayIsArea` heuristics that match the OSM wiki guidance.

## Installation

```sh
npm install @osmix/json
```

## Usage

### Decode a PBF stream

`osmPbfToJson` accepts a Web `ReadableStream<ArrayBufferLike>` and yields the header followed by node/way/relation objects. Pair it with `toAsyncGenerator` from [`@osmix/pbf`](../pbf/README.md) for ergonomic iteration.

```ts
import { osmPbfToJson } from "@osmix/json"
import { toAsyncGenerator } from "@osmix/pbf"

const response = await fetch("/fixtures/monaco.pbf")

for await (const item of toAsyncGenerator(osmPbfToJson(response.body))) {
	if ("id" in item) {
		console.log(item.type, item.tags?.name)
		continue
	}

	console.log("Bounds:", item.bbox)
}
```

### Encode JSON entities back to PBF bytes

`osmJsonToPbf` streams JSON entities into encoded blobs. The input generator should yield the header exactly once followed by sorted entities.

```ts
import { osmJsonToPbf } from "@osmix/json"
import type { OsmPbfHeaderBlock } from "@osmix/pbf"

const header: OsmPbfHeaderBlock = {
	required_features: ["OsmSchema-V0.6"],
	optional_features: [],
	bbox: { left: -77.05, right: -77.0, top: 38.92, bottom: 38.88 },
	writingprogram: "@osmix/json example",
}

async function* entities() {
	yield { id: 1, lat: 38.8893, lon: -77.0502, tags: { name: "Lincoln Memorial" } }
	yield {
		id: 2,
		refs: [1, 3, 4, 1],
		tags: { building: "yes", name: "Reflecting Pool" },
	}
}

await osmJsonToPbf(header, entities()).pipeTo(
	new WritableStream({
		write: (chunk) => {
			// chunk is a Uint8Array containing PBF blob bytes
		},
	}),
)
```

### Parse blocks or emit GeoJSON directly

If you already have parsed blocks, reach for `OsmPbfBlockParser` and friends. Toggle `includeInfo` to hydrate metadata, or use `wayToFeature` / `relationToFeature` helpers to produce GeoJSON.

```ts
import { OsmPbfBlockParser, wayToFeature } from "@osmix/json"

const parser = new OsmPbfBlockParser(block, { includeInfo: true })
const [nodes] = parser // iterable groups

const firstWay = parser.parseWay(block.primitivegroup[0].ways[0])
const feature = wayToFeature(firstWay, (id) => nodeIndex.get(id)!)
```

## API overview

- **Streaming converters**
	- `osmPbfToJson(stream)` – Returns a `ReadableStream` of `OsmPbfHeaderBlock | OsmEntity`.
	- `OsmBlocksToJsonTransformStream` – Turns decoded `OsmPbfBlock`s into entities.
	- `blocksToJsonEntities(block)` – Synchronous generator for in-memory use.
- **JSON → PBF builders**
	- `createOsmJsonReadableStream(header, entities)` – Inserts the header once, then streams entities.
	- `OsmJsonToBlocksTransformStream` – Groups entities into `OsmPbfBlockBuilder` instances with size checks.
	- `jsonEntitiesToBlocks(entities)` – Async generator producing `OsmPbfBlockBuilder`s.
	- `osmJsonToPbf(header, entities)` – High-level helper that pipes builders through `OsmBlocksToPbfBytesTransformStream`.
	- `OsmPbfBlockBuilder` – Handles string tables, dense node delta encoding, and optional info records.
- **Block parsing utilities**
	- `OsmPbfBlockParser` – Decodes groups with configurable `ParseOptions` (tags + metadata).
	- `parseNode`, `parseWay`, `parseRelation`, `parseDenseNodes` – Parser methods for targeted decoding.
- **GeoJSON helpers**
	- `nodeToFeature`, `wayToFeature`, `relationToFeature`, `nodesToFeatures`, `waysToFeatures`.
	- `wayIsArea(refs, tags)` – Re-exports the wiki heuristics used by the GeoJSON helpers.
- **Entity helpers and types**
	- Type guards: `isNode`, `isWay`, `isRelation`.
	- Equality helpers: `isNodeEqual`, `isWayEqual`, `isRelationEqual`, `entityPropertiesEqual`.
	- Types: `OsmEntity`, `OsmNode`, `OsmWay`, `OsmRelation`, `OsmTags`, `OsmInfoParsed`, and `OSM_ENTITY_TYPES`.

## See also

- [`@osmix/pbf`](../pbf/README.md) – Source of the block readers and writers used here.
- [`@osmix/core`](../core/README.md) – Typed-array index that consumes these JSON entities during ingest/export.
- [`@osmix/change`](../change/README.md) – Builds on `@osmix/core` and `@osmix/json` for dedupe and merge workflows.

## Environment and limitations

- Relies on Web Streams, `TextEncoder`/`TextDecoder`, and other modern platform APIs; ensure your runtime exposes them (Bun, Node 20+, current browsers).
- `osmPbfToJson` expects zlib-compressed blobs as emitted by `@osmix/pbf`; other compression formats are not yet supported.
- JSON → PBF pipelines assume entities arrive sorted (nodes, then ways, then relations) so block limits are respected.

## Development

- `bun run test packages/json`
- `bun run lint packages/json`
- `bun run typecheck packages/json`

Run `bun run check` at the repo root before publishing to ensure formatting, lint, and type coverage.
