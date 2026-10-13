# @osmix/pbf

## 0.1.0

### Minor Changes

- `@osmix/pbf` has no runtime dependencies: its protobuf reader and writer are now a typed port of `pbf` 5.1.2's `PbfReader` and `PbfWriter`, exported from the new `@osmix/pbf/protobuf` entry. They write the same bytes as `pbf`. `@osmix/vt` encodes vector tiles with it instead of depending on `pbf`, which drops `pbf`, `resolve-protobuf-schema` and `protocol-buffers-schema` from installs.

### Patch Changes

- `PbfWriter.writePackedVarint` throws for values that do not fit in a varint (`Infinity`, 2^64 and up), as `writeVarint` does. Before, `Infinity` looped forever and 2^64 and up wrote past the bytes the writer had reserved.

## 0.0.10

### Patch Changes

- 368d103: Split shared concerns into `@osmix/types`, `@osmix/geo`, and `@osmix/test-utils`. Add `OsmReader`/`OsmWriter` contracts, curated `osmix` facade exports, and dependency guardrails.
- c7a5a35: Harden parsing, loading, changeset generation, worker orchestration, and package verification across Osmix.

  - `@osmix/pbf`, `@osmix/json`, and `@osmix/load` now validate PBF framing and decompression limits, normalize every supported input form, apply timestamp granularity consistently, translate tags before filtering, remove dangling filtered references, and build every requested spatial index.
  - `@osmix/core` now returns `null` for unknown node-coordinate lookups, safely handles incomplete geometry, caches relation-to-way membership, and avoids repeated ID lookups and per-entity object allocation during sorted iteration.
  - `@osmix/change` now preserves relation references during deduplication, escapes OSC XML attributes, applies changesets non-destructively, allocates collision-free IDs for empty or unsorted data, and resolves pending intersection geometry safely. Its intersection runtime is now vendored and strictly typed, removing the upstream test/build dependency graph.
  - `osmix` now preserves sliced typed-array views during transfer, disposes and terminates owned workers reliably, uses collision-safe worker registries, and supports all documented PBF input forms across local and remote APIs.
  - `@osmix/geojson`, `@osmix/vt`, and `@osmix/shortbread` now consume nullable or read-only geometry data without aliasing or mutation hazards.
  - `@osmix/gtfs` and `@osmix/router` documentation now uses the current archive, routing, transfer, and distance APIs.
  - `@osmix/shared` and `@osmix/test-utils` add executable package smoke coverage for byte streams and checked-in fixtures.
  - Public package examples are classified as compilable or schematic and are checked against current exports and argument types.

## 0.0.9

### Patch Changes

- aba4bd8: Fix for nodejs package imports

## 0.0.8

### Patch Changes

- 2a634cb: Fix publishing

## 0.0.7

### Patch Changes

- 3c8ee95: Fix and simplify package exports

## 0.0.6

### Patch Changes

- f32e4ee: General cleanup

## 0.0.5

### Patch Changes

- f468db5: Fix publishing (2)

## 0.0.4

### Patch Changes

- 68d6bd8: Fix publishing for packages.

## 0.0.3

### Patch Changes

- d001d9a: Refactor to align around new main external API

## 0.0.2

### Patch Changes

- 33d9c12: Modify types to take Uint8Array<ArrayBufferLike> for compatiblity

## 0.0.1

### Patch Changes

- Initial release
