# `@osmix/json`

`@osmix/json` bridges the gap between OpenStreetMap's compact PBF format and ergonomic JSON
representations. It powers the streaming editors inside `apps/merge` and parts of the merge engine in
`@osmix/core` by letting us parse, inspect, transform, and re-encode OSM data without leaving the
browser-friendly world of JavaScript.

This package embraces modern Web Streams and incremental serialization. You can connect network responses, worker threads, and transformation pipelines together without buffering entire files in memory.

## When to use `@osmix/json`

Use this package when you need to:

- Inspect or transform OSM data inside browsers, service workers, or edge runtimes.
- Merge change sets by comparing entity payloads before writing back to PBF.
- Generate GeoJSON overlays or editing layers from raw extracts.
- Test encoding/decoding logic with small fixtures without shelling out to `osmium` or `osmosis`.

If you only need raw block reading/writing, reach directly for `@osmix/pbf`. If you need high-level
conflation and merge operations, see `@osmix/core`.

## Design Notes

- **Streaming first** – Every conversion primitive is available as a Web Stream transform, letting
	you operate on large-scale datasets in browsers or Node without copying.
- **Compatible with modern runtimes** – The package ships pure ESM, targets modern runtimes, and has no
	Node-specific dependencies beyond Web Streams.
- **Info handling is opt-in** – Builders and parsers accept options to include metadata (`timestamp`,
	`uid`, etc.) only when you need it, keeping hot-path allocations low.
- **GeoJSON opinions** – Tag-based heuristics follow the OSM `area` rules so downstream mapping tools
	receive correct `Polygon`/`LineString` geometry by default.

## Installation

```bash
npm i @osmix/json
```

The package ships as pure TypeScript/ESM and depends on the sibling `@osmix/pbf` primitives for the
low-level Protocolbuffer handling.

## Quick Start

### Stream a `.osm.pbf` file to JSON entities

```ts
import { osmPbfToJson } from "@osmix/json"
import { toAsyncGenerator } from "@osmix/pbf"

const response = await fetch("/fixtures/monaco.pbf")

for await (const value of toAsyncGenerator(osmPbfToJson(response.body))) {
	if ("id" in value) {
		// value is an OSM entity: node | way | relation
		console.log(value.tags)
	} else {
		// value is the header block with metadata and bounding box
		console.log("dataset bounds", value.bbox)
	}
}
```

### Emit JSON entities back to PBF bytes

```ts
import type { OsmPbfHeaderBlock } from "@osmix/pbf"
import { osmJsonToPbf } from "@osmix/json"

const header: OsmPbfHeaderBlock = {
	bbox: {
		left: -77.05,
		right: -77.0,
		top: 38.92,
		bottom: 38.88,
	},
	required_features: ["OsmSchema-V0.6"],
	optional_features: [],
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
			// chunk is an ArrayBufferLike holding the encoded PBF data
		},
	}),
)
```

The resulting readable stream yields raw `ArrayBuffer` chunks which can be written to disk, uploaded,
or fed back into `@osmix/pbf` utilities. If you need finer control, pair
`createOsmJsonReadableStream` with `OsmJsonToBlocksTransformStream` before handing off to
`@osmix/pbf`'s `OsmBlocksToPbfBytesTransformStream`.

Way conversion helpers respect `wayIsArea` so polygonal ways become `GeoJSON.Polygon` features automatically.

## API Overview

### Streams and transforms

- `osmPbfToJson(pbfStream)` – Chainable transform that consumes a readable stream of PBF bytes and
	emits the header followed by `OsmEntity` objects.
- `OsmBlocksToJsonTransformStream` – Converts decoded `OsmPbfBlock`s coming from
	`@osmix/pbf` into JSON entities. Useful if you already have block-level access.
- `blocksToJsonEntities(block)` – Synchronous generator for situations where you want to keep things
	in-memory.

### Building blocks from JSON

- `createOsmJsonReadableStream(header, entities)` – Wrap an async generator of `OsmEntity`s in a
	`ReadableStream`, inserting the header exactly once.
- `OsmJsonToBlocksTransformStream` – Groups entities into `OsmPbfBlockBuilder` instances with the
	correct node/way/relation ordering and size constraints.
- `jsonEntitiesToBlocks(entities)` – Async generator alternative that yields block builders.
- `osmJsonToPbf(header, entities)` – High-level pipeline that turns JSON entities straight into PBF
	byte chunks via `OsmBlocksToPbfBytesTransformStream`.
- `OsmPbfBlockBuilder` – Utility class that handles string tables, delta encoding, and optional info
	records when building primitive blocks.

### Parsing PBF blocks

- `OsmPbfBlockParser` – Re-hydrates primitive groups into rich objects. Supports optional info and
	tag parsing via `ParseOptions`.
- `parseNode`, `parseWay`, `parseRelation`, `parseDenseNodes` – Methods on the parser class if you
	need finer control over decoding.

### GeoJSON utilities

- `nodeToFeature`, `nodesToFeatures` – Convert nodes to `GeoJSON.Point` features, defaulting to
	discarding untagged nodes.
- `wayToFeature`, `waysToFeatures` – Derive line or polygon features and optionally inject member nodes.
- `relationToFeature` – Represent relations as geometry collections using member coordinates.
- `wayIsArea(refs, tags)` – Implements the OSM wiki heuristics for determining polygonality.

### Entity helpers and types

- `isNode`, `isWay`, `isRelation` – Type guards for discriminated unions.
- `isNodeEqual`, `isWayEqual`, `isRelationEqual`, `entityPropertiesEqual` – Structural comparisons that
	ignore entity ordering quirks.
- `getEntityType(entity)` – Returns the entity type literal (`"node" | "way" | "relation"`).
- `OsmEntity`, `OsmNode`, `OsmWay`, `OsmRelation`, `OsmTags` – Type definitions shared across the
	workspace.
- `OSM_ENTITY_TYPES` – Tuple of entity literals useful for iteration or validation.
