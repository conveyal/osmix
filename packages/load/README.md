# @osmix/load

Load OpenStreetMap PBF data into `@osmix/core` indexes, create geographic extracts, and export back to PBF. Composes `@osmix/pbf` and `@osmix/json` streaming transforms with spatial extraction and tag-filtering during ingestion.

## Highlights

- **Load** PBF buffers or streams into an in-memory `Osm` index with ID, tag, and spatial indexes.
- **Extract** subsets by bounding box during load or from an existing index (`simple`, `complete_ways`, `smart`).
- **Filter** entities by tag rules while parsing (worker-safe, serializable rules).
- **Export** indexes to PBF via streaming (`toPbfStream`) or a single buffer (`toPbfBuffer`).
- **Stream** PBF to JSON entities with `transformOsmPbfToJson` without building a full index.

## Installation

```sh
pnpm add @osmix/load
```

The `osmix` package re-exports this API for convenience.

## Usage

### Load a PBF file

```ts check-docs monaco-pbf
import { fromPbf } from "osmix";

const osm = await fromPbf(monacoPbf);

console.log(osm.nodes.size, osm.ways.size, osm.relations.size);
```

### Load with bbox extraction during parse

Pass `extractBbox` to clip or extract while streaming. When `extractStrategy` is omitted, bbox loads default to `"simple"` in-stream filtering.

```ts check-docs
import { fromPbf } from "osmix";

const regionResponse = await fetch("./region.pbf");
const regionPbf = new Uint8Array(await regionResponse.arrayBuffer());
const downtown = await fromPbf(regionPbf, {
  extractBbox: [-122.35, 47.6, -122.32, 47.62],
  extractStrategy: "complete_ways",
});
console.log(downtown.id);
```

### Create an extract from a loaded index

```ts check-docs monaco-pbf
import { createExtract, fromPbf } from "osmix";

const osm = await fromPbf(monacoPbf);
const clip = createExtract(osm, [7.41, 43.72, 7.43, 43.74], "smart");
console.log(clip.id);
```

### Export to PBF

```ts check-docs pbf-output
import { fromPbf, toPbfBuffer, toPbfStream } from "osmix";

const monacoResponse = await fetch("./monaco.pbf");
const monacoPbf = new Uint8Array(await monacoResponse.arrayBuffer());
const osm = await fromPbf(monacoPbf);

// Stream to a file (memory-efficient)
await toPbfStream(osm).pipeTo(fileWritableStream);

// Or collect into a buffer
const bytes = await toPbfBuffer(osm);
console.log(bytes.byteLength);
```

### Tag filtering during load

```ts check-docs
import { CONVEYAL_EXTRACT_TAG_FILTERS, fromPbf } from "osmix";

const regionResponse = await fetch("./region.pbf");
const regionPbf = new Uint8Array(await regionResponse.arrayBuffer());
const transit = await fromPbf(regionPbf, {
  extractBbox: [-122.5, 37.7, -122.3, 37.9],
  extractTagFilter: CONVEYAL_EXTRACT_TAG_FILTERS,
});
console.log(transit.id);
```

### Stream PBF to JSON entities

```ts check-docs monaco-pbf
import { transformOsmPbfToJson } from "osmix";

const stream = transformOsmPbfToJson(monacoPbf.buffer);

for await (const entity of stream) {
  if ("id" in entity) {
    console.log(entity.id, entity.tags);
  }
}
```

## API

### Loading and export

| Export                              | Description                                                     |
| ----------------------------------- | --------------------------------------------------------------- |
| `fromPbf(data, options?)`           | Parse PBF into an `Osm` index with optional bbox/tag filters    |
| `startCreateOsmFromPbf`             | Async generator variant that yields progress events during load |
| `readOsmPbfHeader(data)`            | Read only the PBF header block                                  |
| `toPbfStream(osm)`                  | Stream an `Osm` index to spec-compliant PBF bytes               |
| `toPbfBuffer(osm)`                  | Collect streamed PBF bytes into a single `Uint8Array`           |
| `transformOsmPbfToJson`             | Pipe PBF bytes to a stream of header + JSON entities            |
| `createReadableEntityStreamFromOsm` | Emit header + sorted entities from an `Osm` index               |

### Extraction

| Export                                | Description                                             |
| ------------------------------------- | ------------------------------------------------------- |
| `createExtract(osm, bbox, strategy?)` | Build a geographic extract from an existing `Osm` index |
| `ExtractStrategy`                     | `"simple"` \| `"complete_ways"` \| `"smart"`            |

### Tag filters

| Export                           | Description                                                   |
| -------------------------------- | ------------------------------------------------------------- |
| `ExtractTagFilterRules`          | Per-entity-type tag rule lists (`nodes`, `ways`, `relations`) |
| `CONVEYAL_EXTRACT_TAG_FILTERS`   | Default transit / routing-oriented tag rules                  |
| `normalizeTagFilterRules`        | Trim keys, drop blanks, normalize values                      |
| `hasExtractTagFilter`            | Whether any rule list is non-empty after normalization        |
| `nodeMatchesExtractTagRules`     | Test a node against normalized rules                          |
| `wayMatchesExtractTagRules`      | Test a way against normalized rules                           |
| `relationMatchesExtractTagRules` | Test a relation against normalized rules                      |

### Options

`OsmFromPbfOptions` extends `OsmOptions` from `@osmix/core` with:

- `extractBbox` – `[minLon, minLat, maxLon, maxLat]` for in-stream or post-load extraction
- `extractStrategy` – how boundary ways and relations are handled
- `extractTagFilter` – serializable tag rules applied during ingestion
- `filter` – custom per-entity predicate
- `buildSpatialIndexes` – which spatial indexes to build (`"node"`, `"way"`, `"relation"`)

## Related Packages

- [`@osmix/pbf`](../pbf/README.md) – Low-level PBF block parsing and serialization.
- [`@osmix/json`](../json/README.md) – PBF ↔ JSON entity streaming transforms.
- [`@osmix/core`](../core/README.md) – In-memory `Osm` index consumed by loaders.
- [`osmix`](../osmix/README.md) – High-level entrypoint that re-exports this package.

## Environment and Limitations

- Requires Web Streams and `CompressionStream` / `DecompressionStream` (Node 20+, Bun, modern browsers).
- `fromPbf` expects dense-node blocks; sparse node encodings throw.
- `"simple"` in-stream bbox filtering may leave incomplete way geometry at boundaries; prefer `"complete_ways"` or `"smart"` for topology-safe extracts.
- Tag filtering on dense nodes may drop refs when nodes precede ways in a block; use post-load `createExtract` when reference completeness matters.

## Development

```sh
pnpm run test packages/load
pnpm run lint packages/load
pnpm run typecheck packages/load
```

Run `pnpm run check` at the repo root before publishing.
