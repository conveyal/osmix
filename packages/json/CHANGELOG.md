# @osmix/json

## 0.0.17

### Patch Changes

- Updated dependencies [e4785fe]
- Updated dependencies [df04f92]
- Updated dependencies [8be5c80]
  - @osmix/shared@0.2.0
  - @osmix/pbf@0.0.10
  - @osmix/types@0.1.0

## 0.0.16

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
  - @osmix/pbf@0.0.10
  - @osmix/shared@0.1.0
  - @osmix/types@0.1.0

## 0.0.15

### Patch Changes

- d67e38d: Bump dependencies to latest majors and adopt TypeScript 7 RC

## 0.0.14

### Patch Changes

- aba4bd8: Fix for nodejs package imports
- Updated dependencies [aba4bd8]
  - @osmix/pbf@0.0.9
  - @osmix/shared@0.0.13

## 0.0.13

### Patch Changes

- 2a634cb: Fix publishing
- Updated dependencies [2a634cb]
  - @osmix/shared@0.0.12
  - @osmix/pbf@0.0.8

## 0.0.12

### Patch Changes

- 3c8ee95: Fix and simplify package exports
- Updated dependencies [3c8ee95]
  - @osmix/pbf@0.0.7
  - @osmix/shared@0.0.11

## 0.0.11

### Patch Changes

- Updated dependencies [12728ed]
  - @osmix/shared@0.0.10
  - @osmix/pbf@0.0.6

## 0.0.10

### Patch Changes

- Updated dependencies [f32e4ee]
  - @osmix/pbf@0.0.6
  - @osmix/shared@0.0.9

## 0.0.9

### Patch Changes

- f468db5: Fix publishing (2)
- Updated dependencies [f468db5]
  - @osmix/pbf@0.0.5
  - @osmix/shared@0.0.8

## 0.0.8

### Patch Changes

- 68d6bd8: Fix publishing for packages.
- Updated dependencies [68d6bd8]
  - @osmix/pbf@0.0.4
  - @osmix/shared@0.0.7

## 0.0.7

### Patch Changes

- ff40416: Refactor main `osmix` lib external APIs

## 0.0.6

### Patch Changes

- Updated dependencies [0cd8a2e]
  - @osmix/shared@0.0.6
  - @osmix/pbf@0.0.3

## 0.0.5

### Patch Changes

- Updated dependencies [bb629cf]
- Updated dependencies [edbb26b]
- Updated dependencies [69a36bd]
  - @osmix/shared@0.0.5
  - @osmix/pbf@0.0.3

## 0.0.4

### Patch Changes

- d001d9a: Refactor to align around new main external API
- Updated dependencies [572cbd8]
- Updated dependencies [d001d9a]
  - @osmix/shared@0.0.4
  - @osmix/pbf@0.0.3

## 0.0.3

### Patch Changes

- b4a3ff2: Improve Relation handling and display
- Updated dependencies [b4a3ff2]
  - @osmix/shared@0.0.3
  - @osmix/pbf@0.0.2

## 0.0.2

### Patch Changes

- 33d9c12: Modify types to take Uint8Array<ArrayBufferLike> for compatiblity
- Updated dependencies [33d9c12]
  - @osmix/shared@0.0.2
  - @osmix/pbf@0.0.2

## 0.0.1

### Patch Changes

- Initial release
- Updated dependencies
  - @osmix/pbf@0.0.1
  - @osmix/shared@0.0.1
