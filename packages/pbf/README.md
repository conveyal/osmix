# @osmix/pbf

@osmix/pbf is a low-level TypeScript toolkit for reading and writing OpenStreetMap PBF data. It keeps the API surface close to the official protobuf schema, surfaces predictable types, and runs in Node 20+ and modern browsers through Web Streams and native compression primitives.

## Highlights

- Parse headers and primitive blocks from `ArrayBufferLike`, async iterables, or Web `ReadableStream`s.
- Build streaming pipelines with `TransformStream` helpers instead of buffering entire files in memory.
- Serialize header and primitive blocks back to spec-compliant blobs with size guardrails baked in.
- Reuse generated protobuf types/readers so downstream tools can stay close to `osmformat.proto`.
- Utility helpers handle compression, concatenation, and big-endian encoding tuned for the PBF format.

## Installation

```sh
npm install @osmix/pbf
```

## Usage

### Read an entire file

`readOsmPbf` accepts an `ArrayBufferLike`, async iterable, or Web `ReadableStream`. It returns the header block and an async generator of primitive blocks.

```ts
import { readOsmPbf } from "@osmix/pbf"

const response = await fetch("/fixtures/moncao.pbf")
const { header, blocks } = await readOsmPbf(response.body)

console.log(header.required_features)

for await (const block of blocks) {
	for (const group of block.primitivegroup) {
		console.log(group.nodes?.length, group.ways.length, group.relations.length)
	}
}
```

### Stream as you go

Use the streaming helpers when you do not want to materialize the whole file.

```ts
import { OsmPbfBytesToBlocksTransformStream } from "@osmix/pbf"

const response = await fetch("/fixtures/moncao.pbf")

await response.body
	.pipeThrough(new OsmPbfBytesToBlocksTransformStream())
	.pipeTo(
		new WritableStream({
			write: (block) => {
				if ("primitivegroup" in block) {
					// Handle primitive data blocks.
					return
				}

				console.log("Header bbox", block.bbox)
			},
		}),
	)
```

### Write blocks back to PBF

Serialize individual blocks into blobs, or stream them directly to a writable target.

#### Buffer the result

```ts
import { concatUint8, osmBlockToPbfBlobBytes, readOsmPbf } from "@osmix/pbf"

const response = await fetch("/fixtures/moncao.pbf")
const { header, blocks } = await readOsmPbf(response.body)

const chunks: Uint8Array[] = [await osmBlockToPbfBlobBytes(header)]
for await (const block of blocks) chunks.push(await osmBlockToPbfBlobBytes(block))

const fullFile = concatUint8(...chunks)

```

#### Stream to a sink

Generators returned by `readOsmPbf` are single-use. Re-open the source (or buffer the blocks) if you want to stream the same dataset again.

```ts
import { OsmBlocksToPbfBytesTransformStream, readOsmPbf } from "@osmix/pbf"

const response = await fetch("/fixtures/moncao.pbf")
const { header, blocks } = await readOsmPbf(response.body)

const upstream = new ReadableStream({
	async start(controller) {
		controller.enqueue(header)
		for await (const block of blocks) controller.enqueue(block)
		controller.close()
	},
})

await upstream
	.pipeThrough(new OsmBlocksToPbfBytesTransformStream())
	.pipeTo(new WritableStream({ write: persistChunk }))
```

`persistChunk` represents your storage layer (filesystem writes, uploads, IndexedDB, and so on). It receives `Uint8Array` pieces in the order they should be persisted.

## API overview

- `readOsmPbf(data)` – Parses binary PBF data, returning `{ header, blocks }`. Throws if the first block is not an OSM header.
- `OsmPbfBytesToBlocksTransformStream` – Web `TransformStream` that emits the header once and then primitive blocks as they become available.
- `OsmBlocksToPbfBytesTransformStream` – Inverse transform that turns header/primitive blocks into PBF byte blobs while enforcing size limits.
- `createOsmPbfBlobGenerator()` – Returns a stateful generator that slices incoming bytes into compressed blob payloads (`Uint8Array`s), emitting the header blob first.
- `osmPbfBlobsToBlocksGenerator(blobs)` – Accepts a (async) generator of compressed blobs, decompresses them, and yields the header followed by primitive blocks.
- `osmBlockToPbfBlobBytes(block)` – Serializes a single header or primitive block, returning the BlobHeader length prefix and blob bytes as one `Uint8Array`.
- Utility exports: `toAsyncGenerator`, `compress`, `decompress`, `concatUint8`, `uint32BE`, and the size constants from `spec.ts`. Compression helpers detect Bun and fall back to Node's zlib bindings for compatibility.
- Generated protobuf helpers: `readHeaderBlock`, `writeHeaderBlock`, `readPrimitiveBlock`, `writePrimitiveBlock`, plus the associated TypeScript types (`OsmPbfBlock`, `OsmPbfHeaderBlock`, `OsmPbfBlob`, and friends).

## Environment and limitations

- Requires runtimes with Web Streams + `CompressionStream` / `DecompressionStream` support (modern browsers, Node 20+).
- Only `zlib_data` blobs are supported today; files containing `raw` or `lzma` payloads will throw.
- When working with Node `Readable` / `Writable` streams, adapt them to Web Streams (`stream/web`) before passing them to these helpers.

## Development

- `bun run test packages/pbf`
- `bun run lint packages/pbf`
- `bun run typecheck packages/pbf`

Run `bun run check` at the repo root before publishing to ensure formatting, lint, and type coverage.
