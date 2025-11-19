# @osmix/pbf

A low-level TypeScript library for reading and writing OpenStreetMap PBF data. It keeps the API surface close to the official protobuf schema, surfaces predictable types, and runs in Node and modern browsers through Web Streams and native compression primitives.

## Highlights

- Parse headers and primitive blocks from `ArrayBufferLike`, async iterables, or Web `ReadableStream`s.
- Build streaming pipelines with `TransformStream` helpers instead of buffering entire files in memory.
- Serialize header and primitive blocks back to spec-compliant blobs with size guardrails baked in.
- Reuse generated protobuf types/readers so downstream tools can stay close to `osmformat.proto`.
- Utility helpers handle compression, concatenation, and big-endian encoding tuned for the PBF format.
- Expose TypeScript types for generated OSM ProtocolBuffer methods and data sturtures.

## Installation

```sh
bun install @osmix/pbf
```

## Usage

### Read an entire file

`readOsmPbf` accepts an `ArrayBufferLike`, async iterable, or Web `ReadableStream`. It returns the header block and an async generator of primitive blocks.

```ts
import { readOsmPbf } from "@osmix/pbf"

const { header, blocks } = await readOsmPbf(Bun.file('./monaco.pbf').stream())

console.log(header.required_features)

for await (const block of blocks) {
	for (const group of block.primitivegroup) {
		console.log(group.nodes?.length, group.ways.length, group.relations.length)
	}
}
```

## API

WIP

## See also

- [`@osmix/json`](../json/README.md) – Converts parsed blocks into ergonomic JSON or GeoJSON entities.
- [`@osmix/core`](../core/README.md) – Uses these readers/writers for ingest and export workflows.
- [`@osmix/change`](../change/README.md) – Builds on `@osmix/core` to generate change pipelines.

## Environment and limitations

- Requires runtimes with Web Streams + `CompressionStream` / `DecompressionStream` support (modern browsers, Node 20+).
- Only `zlib_data` blobs are supported today; files containing `raw` or `lzma` payloads will throw.
- When working with Node `Readable` / `Writable` streams, adapt them to Web Streams (`stream/web`) before passing them to these helpers.

### Memory usage guidance

- Prefer streaming transforms (`OsmPbfBytesToBlocksTransformStream` → `OsmBlocksToPbfBytesTransformStream`) for large extracts to avoid materializing entire files.
- Re-materializing full files (e.g., concatenating all blocks into one buffer) can require memory roughly proportional to input size plus transient compression buffers.
- In browsers, keep an eye on available heap limits (2–4 GB typical). 

## Development

- `bun run test packages/pbf`
- `bun run lint packages/pbf`
- `bun run typecheck packages/pbf`

Run `bun run check` at the repo root before publishing to ensure formatting, lint, and type coverage.
