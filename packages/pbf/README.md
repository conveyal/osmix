# @osmix/pbf

A low-level TypeScript toolkit for reading and writing [OpenStreetMap PBF](https://wiki.openstreetmap.org/wiki/PBF_Format) data. The package focuses on predictable data structures, modern runtimes (Bun, Node 22+, modern browsers), and composable primitives that can be plugged into higher-level OSM tooling.

## Background

- Existing JavaScript PBF readers either depend on outdated tooling, mutate data into framework-specific shapes, or ship without useful TypeScript declarations.
- `@osmix/pbf` keeps the API surface close to the official OSM protobuf definition so downstream consumers can decide how they want to process, index, or re-shape the data.
- The library embraces Web Streams and native compression APIs, enabling the same code paths to run inside browsers, Bun, and modern Node without extra dependencies.

## Features

- Parse OSM headers and primitive blocks from an `ArrayBuffer`, async iterable, or `ReadableStream`.
- Emit strongly-typed protobuf objects that mirror the upstream `osmformat.proto` and `fileformat.proto` definitions.
- Convert parsed blocks back into PBF-compliant blobs, enforcing recommended and maximum blob sizes from the OSM spec.
- Bridge between raw byte streams and OSM entities using TransformStreams for efficient streaming pipelines.
- Provide utility helpers (compression, concatenation, big-endian encoding) tuned for the PBF binary format.

## Installation

```sh
bun add @osmix/pbf
# or
npm install @osmix/pbf
```

## Quickstart

### Reading an entire file

```ts
import { readOsmPbf } from "@osmix/pbf"

const source = await fetch("/fixtures/chicago.osm.pbf")
const arrayBuffer = await source.arrayBuffer()

const { header, blocks } = await readOsmPbf(arrayBuffer)
console.log(header.required_features)

for await (const block of blocks) {
	for (const group of block.primitivegroup) {
		console.log(group.nodes?.length, group.ways.length, group.relations.length)
	}
}
```

### Streaming from network or disk

```ts
import { OsmPbfBytesToBlocksTransformStream } from "@osmix/pbf"

const response = await fetch("/fixtures/city.osm.pbf")
const stream = response.body
if (!stream) throw new Error("Response has no body stream")

await stream
	.pipeThrough(new OsmPbfBytesToBlocksTransformStream())
	.pipeTo(
		new WritableStream({
			write: (block) => {
				if ("primitivegroup" in block) {
					for (const group of block.primitivegroup) {
						// handle nodes / ways / relations
					}
				} else {
					console.log("Header bbox", block.bbox)
				}
			},
		}),
	)
```

### Writing blocks back to an OSM PBF

```ts
import {
	OsmBlocksToPbfBytesTransformStream,
	osmBlockToPbfBlobBytes,
	readOsmPbf,
} from "@osmix/pbf"

const source = await fetch("/fixtures/chicago.osm.pbf")
const { header, blocks } = await readOsmPbf(await source.arrayBuffer())

// Assemble the bytes in-memory
const chunks: Uint8Array[] = [await osmBlockToPbfBlobBytes(header)]
for await (const block of blocks) {
	chunks.push(await osmBlockToPbfBlobBytes(block))
}
const size = chunks.reduce((total, chunk) => total + chunk.length, 0)
const fullFile = new Uint8Array(size)
let offset = 0
for (const chunk of chunks) {
	fullFile.set(chunk, offset)
	offset += chunk.length
}

// Or stream the same data to any WritableStream destination
const blockStream = new ReadableStream({
	async start(controller) {
		controller.enqueue(header)
		for await (const block of blocks) controller.enqueue(block)
		controller.close()
	},
})
const pbfStream = blockStream.pipeThrough(new OsmBlocksToPbfBytesTransformStream())
await pbfStream.pipeTo(new WritableStream({ write: persistChunk }))
```

In the streaming example, `persistChunk` represents whatever logic you use to persist bytes (writing to the file system, uploading to S3, saving to IndexedDB, etc.). The only requirement is that it accepts `Uint8Array` chunks.

## API reference

### High-level helpers

- `readOsmPbf(data: ArrayBufferLike | ReadableStream<ArrayBufferLike>)`
  - Consumes binary PBF data from a buffer, async generator, or readable stream.
  - Returns `{ header, blocks }` where `header` is an `OsmPbfHeaderBlock` and `blocks` is an async generator of `OsmPbfBlock` objects.
  - Throws if the first block cannot be parsed as the required OSM header.

### Streaming primitives

- `OsmPbfBytesToBlocksTransformStream`
  - A `TransformStream<ArrayBufferLike, OsmPbfHeaderBlock | OsmPbfBlock>` that incrementally parses byte chunks, emitting the header first and primitive blocks afterwards.
  - Internally uses `createOsmPbfBlobGenerator` and `decompress` to turn byte ranges into decompressed protobuf blocks.
- `OsmBlocksToPbfBytesTransformStream`
  - A `TransformStream<OsmPbfHeaderBlock | OsmPbfBlock, Uint8Array>` that serialises header and primitive blocks back to PBF byte blobs.
  - Validates block sizes against spec recommendations and throws if the maximum size is exceeded.

### Generator-level building blocks

- `createOsmPbfBlobGenerator()`
  - Produces a stateful generator function that ingests raw byte chunks and yields compressed blob bodies (`Uint8Array` instances containing zlib data).
  - Useful when you need to inspect or cache raw blob payloads before decompression.
- `osmPbfBlobsToBlocksGenerator(blobs)`
  - Accepts a generator or async generator of compressed blob payloads.
  - Decompresses each blob and yields the parsed header (`OsmPbfHeaderBlock`) followed by primitive blocks.
- `osmBlockToPbfBlobBytes(block)`
  - Serialises a single `OsmPbfHeaderBlock` or `OsmPbfBlock` into a PBF-compliant `Uint8Array` (blob header + blob body).
  - Emits warnings when a blob exceeds the recommended size and throws when hard limits are breached.

### Utilities

- `toAsyncGenerator(value)` – Normalises a value, iterable, async iterable, or `ReadableStream` into an async generator.
- `decompress(data, format?)` – Uses the platform `DecompressionStream` API to decompress blob contents (defaults to `"deflate"`).
- `compress(data, format?)` – Counterpart to `decompress`, leveraging `CompressionStream` to create spec-compliant zlib payloads.
- `concatUint8(...chunks)` – Concatenates `Uint8Array` segments, used when building PBF files in memory.
- `uint32BE(value)` – Encodes a 32-bit unsigned integer in big-endian byte order. Utilised when prefixing blob headers with their length.

### Spec helpers

- `RECOMMENDED_HEADER_SIZE_BYTES`, `MAX_HEADER_SIZE_BYTES`
- `RECOMMENDED_BLOB_SIZE_BYTES`, `MAX_BLOB_SIZE_BYTES`
- `MAX_ENTITIES_PER_BLOCK`

These constants are surfaced to help callers validate or tune batching strategies before serialising blocks.

### Generated protobuf bindings

All types and read/write helpers generated from the official `.proto` files are re-exported, including:

- `readHeaderBlock`, `writeHeaderBlock`, `readPrimitiveBlock`, `writePrimitiveBlock`
- Type definitions such as `OsmPbfHeaderBlock`, `OsmPbfBlock`, `OsmPbfBlob`, `OsmPbfBlobHeader`, and entity-level message types (nodes, ways, relations, string tables, dense info, etc.)

The generated code matches the schema shipped by the OSM project, so you can trust it to stay close to the wire format while benefiting from TypeScript type inference.

## Environment notes

- Streaming examples rely on the standard Web Streams API. In Node 22+ and Bun, the API is available globally; older runtimes are not supported.
- Compression utilities depend on `CompressionStream` / `DecompressionStream`. Bun and modern browsers expose these natively. Node added support in v18 behind a flag and promoted it to stable in newer releases—enable it accordingly when targeting Node.
- When feeding Node.js `Readable`/`Writable` streams into these helpers, use `stream/web` utilities (`Readable.toWeb`, `Writable.toWeb`) or another adapter so you interact with Web Streams.

## Related packages

This package powers higher-level merging and editing features in `@osmix/core` and the `apps/merge` UI. Keeping the PBF layer standalone lets other tools reuse the same fast parser without pulling in application-specific dependencies.

## Development

- `bun run test packages/pbf`
- `bun run lint packages/pbf`
- `bun run typecheck packages/pbf`

Run `bun run check` at the repo root before publishing to verify formatting, lint, and type coverage.
