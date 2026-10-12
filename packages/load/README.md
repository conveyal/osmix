# @osmix/load

Load OpenStreetMap PBF data into `@osmix/core` indexes, create geographic extracts, and export back to PBF. Composes `@osmix/pbf` and `@osmix/json` streaming transforms with spatial extraction and tag-filtering during ingestion.

## Highlights

- **Load** PBF buffers or streams into an in-memory `Osm` index with ID, tag, and spatial indexes.
- **Profile** spatial indexing as Auto, Full, or View, or select individual index capabilities explicitly.
- **Diagnose** projected typed-buffer peaks and allocation ceilings before constructing large spatial indexes.
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

`@osmix/load` defaults to the Full profile for compatibility with existing callers. Applications that can
operate without an all-node spatial index can request Auto:

```ts check-docs monaco-pbf
import { fromPbf } from "osmix";

const osm = await fromPbf(monacoPbf, {
  loadProfile: "auto",
  loadCapabilities: {
    deviceMemoryBytes: 16 * 2 ** 30,
    arrayBufferMaxBytes: 2_144_777_216,
    sharedArrayBufferMaxBytes: 2_144_777_216,
    activeBufferType: "shared-array-buffer",
  },
});

console.log(osm.info().spatialIndexes);
```

For deterministic control, an explicit spatial-index selection takes precedence over `loadProfile`:

```ts check-docs monaco-pbf
import { fromPbf } from "osmix";

const osm = await fromPbf(monacoPbf, {
  loadProfile: "full",
  spatialIndexes: {
    nodes: ["tagged"],
    ways: true,
    relations: true,
  },
});

console.log(osm.info().spatialIndexes.nodes.all); // false
```

### Load profiles

| Profile | Node indexes                                    | Way index | Relation index | Intended use                                  |
| ------- | ----------------------------------------------- | --------- | -------------- | --------------------------------------------- |
| Full    | all and tagged                                  | yes       | yes            | Complete algorithms and arbitrary node lookup |
| View    | tagged only                                     | yes       | yes            | Rendering, tag search, and entity inspection  |
| Auto    | Full when within memory budgets; otherwise View | —         | —              | Runtime-selected browser loading              |

Auto selects Full only when all three checks pass:

- the all-node index is at most 256 MiB;
- the projected typed-buffer peak is within the smaller of 4 GiB and 40% of reported device memory; and
- every planned allocation is below 80% of the tested ceiling for the active buffer type.

Reported device memory is advisory. A View working-set estimate above its guideline produces a warning and
still attempts the load. A planned allocation above the hard active-buffer budget throws
`OsmLoadCapacityError` before construction, with required and available byte counts. A missing node
capability later throws `SpatialIndexNotBuiltError`; both errors expose structured fields suitable for worker
transport.

That preflight applies to planned spatial indexes. Mandatory entity columns are finalized before profile
selection and remain present in Auto, Full, and View. If one of those columns cannot fit in a single browser
buffer, core throws `OsmEntityIndexBuildError` with nested `TypedBufferAllocationError` details including the
entity/component, element count, buffer type, and exact required bytes. Changing profiles cannot avoid such a
core-storage failure.

`Osm.info()` reports selected spatial capabilities and optional load diagnostics: the requested and selected
profiles, selection reasons, resident and projected typed-buffer bytes, largest planned allocation, storage
bytes, budgets, phase timings, and tag/reference/member counters.

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

Way and relation rules select the ways and relations to keep. Node rules select only standalone nodes: every node that a kept way references, and every node member of a kept relation, is kept whatever its tags. So a node rule never breaks way geometry. Nodes stream before the ways that reference them, so node rules are applied after ingestion by `pruneUnreferencedNodes`. With no node rules, every node is kept. Tag filters select entities; they never remove tags from them.

`CONVEYAL_EXTRACT_TAG_FILTERS` keeps what [R5](https://github.com/conveyal/r5) reads to build a transit network: highways, platforms, park and ride ways and nodes, and turn restrictions. The node tags R5 reads on street vertices (for example `highway=traffic_signals`) survive because street vertices are always kept.

### Turn restrictions

A router skips a turn restriction when one of its members is absent from the file, but a restriction with a member removed from its member list can restrict the wrong turn. So extracts never remove members from a `type=restriction` relation:

| Strategy                      | A restriction the extract cuts                                                       |
| ----------------------------- | ------------------------------------------------------------------------------------ |
| None (tag filters only)       | Kept with all members listed, even when a member way was filtered out                |
| `"simple"`, `"complete_ways"` | Dropped                                                                              |
| `"smart"`                     | Completed with its member ways and their nodes; dropped if the source lacks a member |

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
| `pruneUnreferencedNodes`         | Drop nodes no way or relation references and no rule matches  |
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
- `loadProfile` – `"auto"`, `"full"`, or `"view"`; defaults to `"full"`
- `loadCapabilities` – advisory device-memory and tested buffer-ceiling inputs used by Auto
- `spatialIndexes` – explicit `OsmSpatialIndexSelection`; takes precedence over `loadProfile`

## Related Packages

- [`@osmix/pbf`](../pbf/README.md) – Low-level PBF block parsing and serialization.
- [`@osmix/json`](../json/README.md) – PBF ↔ JSON entity streaming transforms.
- [`@osmix/core`](../core/README.md) – In-memory `Osm` index consumed by loaders.
- [`osmix`](../osmix/README.md) – High-level entrypoint that re-exports this package.

## Environment and Limitations

- Requires Web Streams and `CompressionStream` / `DecompressionStream` (Node 24+, Bun, modern browsers).
- `fromPbf` expects dense-node blocks; sparse node encodings throw.
- `"simple"` in-stream bbox filtering may leave incomplete way geometry at boundaries; prefer `"complete_ways"` or `"smart"` for topology-safe extracts.
- `createExtract` selects ways only by their nodes inside the bbox and adds entities in ascending ID order. With `"smart"`, multipolygon members missing from the source file (for example boundaries cut at a regional file's edge) are dropped and reported through `onProgress`. Membership is tracked as bitsets over source entity indexes, so memory scales with the source dataset (about 1 bit per entity per tracking set) rather than hitting JS `Set` limits.
- Node tag rules are applied after the whole file is loaded, so a tag-filtered load has the same peak memory as an unfiltered one.
- Ways that reference nodes absent from the source file keep those refs (`missingRefIds`), and export writes them as they are. Some consumers fail on them: R5 can fail to build a network when such a way is the `via` way of a turn restriction.
- Auto selects Full only when the all-node index is at most 256 MiB (67,108,864 nodes), the projected typed-array peak is below both 4 GiB and 40% of the device memory, and each allocation is below 80% of the tested buffer ceiling. The values are exported as `AUTO_LOAD_PROFILE_LIMITS`.
- Memory after a Full load is about 5× the PBF file size. The peak during the load is about 6× to 7×. See [docs/limits.md](../../docs/limits.md#measured-memory-use) for measurements.
- View supports simple in-stream extraction. Complete/smart extraction, deduplication, routing, and other
  arbitrary-node spatial operations require Full; callers must reload or explicitly build the all-node
  capability.

## Development

```sh
pnpm run test packages/load
pnpm run lint packages/load
pnpm run typecheck packages/load
```

Run `pnpm run check` at the repo root before publishing.
