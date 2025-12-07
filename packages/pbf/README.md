# @osmix/pbf

Low-level TypeScript library for reading and writing OpenStreetMap PBF data. Stays close to the official protobuf schema (`osmformat.proto`, `fileformat.proto`), exposes predictable types, and runs in Node.js and modern browsers via Web Streams and native compression primitives.

## Highlights

- **Parse** headers and primitive blocks from `ArrayBufferLike`, async iterables, or Web `ReadableStream`s.
- **Stream** with `TransformStream` helpers instead of buffering entire files in memory.
- **Serialize** header and primitive blocks back to spec-compliant blobs with size guardrails.
- **Types** generated from protobuf schemas for type-safe access to OSM data structures.
- **Utilities** for compression, concatenation, and big-endian encoding tuned for the PBF format.

## Installation

```sh
bun add @osmix/pbf
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

### Streaming with TransformStreams

For large files, use `TransformStream` helpers to process data incrementally:

```ts
import {
	OsmPbfBytesToBlocksTransformStream,
	OsmBlocksToPbfBytesTransformStream,
} from "@osmix/pbf"

// Decode PBF bytes into blocks
const blocksStream = response.body!
	.pipeThrough(new OsmPbfBytesToBlocksTransformStream())

// Encode blocks back to PBF bytes
const pbfStream = blocksStream
	.pipeThrough(new OsmBlocksToPbfBytesTransformStream())
```

### Write a PBF file

```ts
import { osmBlockToPbfBlobBytes } from "@osmix/pbf"

// Serialize a header block
const headerBytes = await osmBlockToPbfBlobBytes({
	required_features: ["OsmSchema-V0.6", "DenseNodes"],
	optional_features: [],
})

// Serialize a primitive block
const dataBytes = await osmBlockToPbfBlobBytes(primitiveBlock)
```

## API

### Reading

| Export | Description |
|--------|-------------|
| `readOsmPbf(data)` | Parse PBF from buffer/stream/iterable into header + blocks generator |
| `OsmPbfBytesToBlocksTransformStream` | TransformStream: raw bytes → header/primitive blocks |
| `createOsmPbfBlobGenerator()` | Stateful parser that extracts compressed blobs from byte chunks |
| `osmPbfBlobsToBlocksGenerator(blobs)` | Async generator: compressed blobs → typed blocks |
| `readOsmHeaderBlock(blob)` | Decompress and parse a header blob |
| `readOsmPrimitiveBlock(blob)` | Decompress and parse a primitive blob |

### Writing

| Export | Description |
|--------|-------------|
| `osmBlockToPbfBlobBytes(block)` | Serialize a block to spec-compliant PBF bytes |
| `OsmBlocksToPbfBytesTransformStream` | TransformStream: header/primitive blocks → PBF bytes |

### Types

| Export | Description |
|--------|-------------|
| `OsmPbfHeaderBlock` | Parsed header with required/optional features and bbox |
| `OsmPbfBlock` | Parsed primitive block with string table and groups |
| `OsmPbfGroup` | Primitive group containing nodes, ways, or relations |
| `OsmPbfDenseNodes` | Delta-encoded dense node format |
| `OsmPbfWay`, `OsmPbfRelation`, `OsmPbfNode` | Raw entity structures |

### Constants

| Export | Description |
|--------|-------------|
| `MAX_BLOB_SIZE_BYTES` | Maximum blob size per spec (32 MiB) |
| `RECOMMENDED_BLOB_SIZE_BYTES` | Recommended blob size (16 MiB) |
| `MAX_ENTITIES_PER_BLOCK` | Recommended max entities per block (8,000) |

## Related Packages

- [`@osmix/json`](../json/README.md) – Converts parsed blocks into ergonomic JSON entities.
- [`@osmix/core`](../core/README.md) – In-memory storage using these readers/writers.
- [`@osmix/change`](../change/README.md) – Changeset and merge workflows.

## Environment and Limitations

- Requires runtimes with Web Streams + `CompressionStream` / `DecompressionStream` (modern browsers, Node 20+, Bun).
- Only `zlib_data` blobs are supported; files with `raw` or `lzma` payloads will throw.
- When working with Node `Readable` / `Writable` streams, adapt them to Web Streams (`stream/web`) first.

### Memory Guidance

- Prefer streaming transforms (`OsmPbfBytesToBlocksTransformStream` → `OsmBlocksToPbfBytesTransformStream`) for large extracts.
- Materializing full files requires memory proportional to input size plus compression buffers.
- In browsers, watch heap limits (typically 2–4 GB).

## Development

```sh
bun run test packages/pbf
bun run lint packages/pbf
bun run typecheck packages/pbf
```

Run `bun run check` at the repo root before publishing to ensure formatting, lint, and type coverage.
