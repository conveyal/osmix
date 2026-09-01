# @osmix/gtfs

## 0.0.12

### Patch Changes

- Updated dependencies [e4785fe]
- Updated dependencies [df04f92]
- Updated dependencies [5c624d5]
- Updated dependencies [e4785fe]
- Updated dependencies [e938749]
- Updated dependencies [8be5c80]
  - @osmix/shared@0.2.0
  - @osmix/core@0.3.0
  - @osmix/raster@0.1.0
  - @osmix/types@0.1.0

## 0.0.11

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

- Updated dependencies [368d103]
- Updated dependencies [368d103]
- Updated dependencies [c7a5a35]
  - @osmix/core@0.2.0
  - @osmix/shared@0.1.0
  - @osmix/types@0.1.0
  - @osmix/raster@0.0.14

## 0.0.10

### Patch Changes

- d67e38d: Bump dependencies to latest majors and adopt TypeScript 7 RC
- Updated dependencies [d67e38d]
  - @osmix/core@0.1.10

## 0.0.9

### Patch Changes

- Updated dependencies [6144903]
  - @osmix/core@0.1.9

## 0.0.8

### Patch Changes

- aba4bd8: Fix for nodejs package imports
- Updated dependencies [aba4bd8]
  - @osmix/core@0.1.8
  - @osmix/shared@0.0.13

## 0.0.7

### Patch Changes

- 2a634cb: Fix publishing
- Updated dependencies [2a634cb]
  - @osmix/shared@0.0.12
  - @osmix/core@0.1.7

## 0.0.6

### Patch Changes

- 3c8ee95: Fix and simplify package exports
- Updated dependencies [3c8ee95]
  - @osmix/core@0.1.6
  - @osmix/shared@0.0.11

## 0.0.5

### Patch Changes

- 12728ed: Replace `csv-parse` usage in `@osmix/gtfs` with a browser-friendly shared streaming CSV parser in `@osmix/shared`, adapted from `mafintosh/csv-parser` parsing behavior.
- Updated dependencies [12728ed]
  - @osmix/shared@0.0.10
  - @osmix/core@0.1.5

## 0.0.4

### Patch Changes

- f32e4ee: General cleanup
- Updated dependencies [f32e4ee]
  - @osmix/core@0.1.4
  - @osmix/shared@0.0.9

## 0.0.3

### Patch Changes

- f468db5: Fix publishing (2)
- 536a3cd: Remove JSR dependency for CSV parsing
- Updated dependencies [f468db5]
  - @osmix/core@0.1.3
  - @osmix/shared@0.0.8

## 0.0.2

### Patch Changes

- 68d6bd8: Fix publishing for packages.
- Updated dependencies [68d6bd8]
  - @osmix/core@0.1.2
  - @osmix/shared@0.0.7

## 0.0.1

### Added

- Initial release with GTFS to OSM conversion.
- Stops parsed as nodes with tags.
- Routes parsed as ways with shape geometry.
