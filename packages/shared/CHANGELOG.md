# @osmix/shared

## 0.1.0

### Minor Changes

- 368d103: Split shared concerns into `@osmix/types`, `@osmix/geo`, and `@osmix/test-utils`. Add `OsmReader`/`OsmWriter` contracts, curated `osmix` facade exports, and dependency guardrails.

### Patch Changes

- c7a5a35: Harden parsing, loading, changeset generation, worker orchestration, and package verification across Osmix.

  - `@osmix/pbf`, `@osmix/json`, and `@osmix/load` now validate PBF framing and decompression limits, normalize every supported input form, apply timestamp granularity consistently, translate tags before filtering, remove dangling filtered references, and build every requested spatial index.
  - `@osmix/core` now returns `null` for unknown node-coordinate lookups, safely handles incomplete geometry, caches relation-to-way membership, and avoids repeated ID lookups and per-entity object allocation during sorted iteration.
  - `@osmix/change` now preserves relation references during deduplication, escapes OSC XML attributes, applies changesets non-destructively, allocates collision-free IDs for empty or unsorted data, and resolves pending intersection geometry safely. Its intersection runtime is now vendored and strictly typed, removing the upstream test/build dependency graph.
  - `osmix` now preserves sliced typed-array views during transfer, disposes and terminates owned workers reliably, uses collision-safe worker registries, and supports all documented PBF input forms across local and remote APIs.
  - `@osmix/geojson`, `@osmix/vt`, and `@osmix/shortbread` now consume nullable or read-only geometry data without aliasing or mutation hazards.
  - `@osmix/gtfs` and `@osmix/router` documentation now uses the current archive, routing, transfer, and distance APIs.
  - `@osmix/shared` and `@osmix/test-utils` add executable package smoke coverage for byte streams and checked-in fixtures.
  - Public package examples are classified as compilable or schematic and are checked against current exports and argument types.

## 0.0.13

### Patch Changes

- aba4bd8: Fix for nodejs package imports

## 0.0.12

### Patch Changes

- 2a634cb: Fix publishing

## 0.0.11

### Patch Changes

- 3c8ee95: Fix and simplify package exports

## 0.0.10

### Patch Changes

- 12728ed: Replace `csv-parse` usage in `@osmix/gtfs` with a browser-friendly shared streaming CSV parser in `@osmix/shared`, adapted from `mafintosh/csv-parser` parsing behavior.

## 0.0.9

### Patch Changes

- f32e4ee: General cleanup

## 0.0.8

### Patch Changes

- f468db5: Fix publishing (2)

## 0.0.7

### Patch Changes

- 68d6bd8: Fix publishing for packages.

## 0.0.6

### Patch Changes

- 0cd8a2e: Explore patterns for extending Osmix worker

## 0.0.5

### Patch Changes

- bb629cf: Simplify raster drawing when geometry is smaller than a pixel
- edbb26b: Handle more Relation types
- 69a36bd: Switch Nodes coordinate storage to Int32Array

## 0.0.4

### Patch Changes

- 572cbd8: Raster tile updates
- d001d9a: Refactor to align around new main external API

## 0.0.3

### Patch Changes

- b4a3ff2: Improve Relation handling and display

## 0.0.2

### Patch Changes

- 33d9c12: Modify types to take Uint8Array<ArrayBufferLike> for compatiblity

## 0.0.1

### Patch Changes

- Initial release
