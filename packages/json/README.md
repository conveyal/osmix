# @osmix/json

Turn OpenStreetMap PBF bytes into ergonomic JSON entities (and back again) for streaming editors, change workflows, and browser-based tooling. It builds on the low-level primitives in [`@osmix/pbf`](../pbf/README.md) while staying friendly to modern runtimes (Node 20+, and modern browsers).

## Highlights

- Decode `.osm.pbf` streams into header metadata and strongly typed node/way/relation JSON.
- Encode JSON entities back into spec-compliant PBF blobs without hand-rolling string tables or delta encoding.
- Compose Web Stream transforms to keep large datasets out of memory and re-use work across workers or service boundaries.

## Installation

```sh
bun install @osmix/json
```

## Usage

### Decode a PBF stream

```ts
import { osmPbfToJson } from "@osmix/json"
import { toAsyncGenerator } from "@osmix/pbf"

const response = await fetch("/fixtures/monaco.pbf")

for await (const item of toAsyncGenerator(osmPbfToJson(Bun.file('./monaco.pbf').stream()))) {
	if ("id" in item) {
		console.log(item.type, item.tags?.name)
		continue
	}

	console.log("Bounds:", item.bbox)
}
```

## API

WIP

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
