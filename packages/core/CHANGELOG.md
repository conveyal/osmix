# @osmix/core

## 0.3.0

### Minor Changes

- e4785fe: Enable memory-aware loading of Australia-scale PBF data. Core storage and transfers now use the compact
  version 2 representation, node spatial queries use independent indirect all-node and tagged-node indexes, and
  loaders expose Auto, Full, View, and explicit spatial-index selection with structured capacity diagnostics.
  Vector-tile encoders use the tagged-node capability without requiring an all-node index.
- e4785fe: Expose structured typed-buffer and entity-finalization failures across workers, identify safe View-profile
  retries for spatial capacity errors, and show persistent actionable dataset-load diagnostics in Merge.

### Patch Changes

- df04f92: Add a cross-runtime managed worker pool with browser, Bun, Deno, and Node worker support,
  cooperative cancellation utilities, a transferable Shortbread feature index, and worker-backed
  consumer integrations.
- 8be5c80: Allow Osmix to use its ArrayBuffer fallback when SharedArrayBuffer is unavailable, so browser
  applications no longer need to install a global SharedArrayBuffer shim.
- Updated dependencies [e4785fe]
- Updated dependencies [df04f92]
- Updated dependencies [8be5c80]
  - @osmix/shared@0.2.0
  - @osmix/geo@0.1.0
  - @osmix/types@0.1.0

## 0.2.0

### Minor Changes

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

### Patch Changes

- Updated dependencies [368d103]
- Updated dependencies [368d103]
- Updated dependencies [c7a5a35]
  - @osmix/shared@0.1.0
  - @osmix/geo@0.1.0
  - @osmix/types@0.1.0

## 0.1.10

### Patch Changes

- d67e38d: Bump dependencies to latest majors and adopt TypeScript 7 RC

## 0.1.9

### Patch Changes

- 6144903: Use published kdbush package for pnpm compatibility

## 0.1.8

### Patch Changes

- aba4bd8: Fix for nodejs package imports
- Updated dependencies [aba4bd8]
  - @osmix/shared@0.0.13

## 0.1.7

### Patch Changes

- 2a634cb: Fix publishing
- Updated dependencies [2a634cb]
  - @osmix/shared@0.0.12

## 0.1.6

### Patch Changes

- 3c8ee95: Fix and simplify package exports
- Updated dependencies [3c8ee95]
  - @osmix/shared@0.0.11

## 0.1.5

### Patch Changes

- Updated dependencies [12728ed]
  - @osmix/shared@0.0.10

## 0.1.4

### Patch Changes

- f32e4ee: General cleanup
- Updated dependencies [f32e4ee]
  - @osmix/shared@0.0.9

## 0.1.3

### Patch Changes

- f468db5: Fix publishing (2)
- Updated dependencies [f468db5]
  - @osmix/shared@0.0.8

## 0.1.2

### Patch Changes

- 68d6bd8: Fix publishing for packages.
- Updated dependencies [68d6bd8]
  - @osmix/shared@0.0.7

## 0.1.1

### Patch Changes

- d4f4b1f: Add content hashing for quick `isEqual`s checks of two similar `Osm` indexes. Typically used for checking post-merge.

## 0.1.0

### Minor Changes

- 29ed376: Routing: make graph transferable

### Patch Changes

- 803c05c: Merge app style cleanup
- cbe4273: Osm index storage and reload
- ff40416: Refactor main `osmix` lib external APIs

## 0.0.6

### Patch Changes

- 3846a0c: Integrate geographic spatial indexing libraries
- cdab4db: Add router
- Updated dependencies [0cd8a2e]
  - @osmix/shared@0.0.6

## 0.0.5

### Patch Changes

- a33a280: Create an easy way to estimate bytes required for a given OSM size
- edbb26b: Handle more Relation types
- 69a36bd: Switch Nodes coordinate storage to Int32Array
- Updated dependencies [bb629cf]
- Updated dependencies [edbb26b]
- Updated dependencies [69a36bd]
  - @osmix/shared@0.0.5

## 0.0.4

### Patch Changes

- d001d9a: Refactor to align around new main external API
- 4303c40: Refactor core Osmix index to prepare for future work
- Updated dependencies [572cbd8]
- Updated dependencies [d001d9a]
  - @osmix/shared@0.0.4

## 0.0.3

### Patch Changes

- b4a3ff2: Improve Relation handling and display
- c0193dd: Import GeoJSON into Osmix
- Updated dependencies [b4a3ff2]
  - @osmix/shared@0.0.3
  - @osmix/json@0.0.3
  - @osmix/pbf@0.0.2

## 0.0.2

### Patch Changes

- 33d9c12: Modify types to take Uint8Array<ArrayBufferLike> for compatiblity
- Updated dependencies [33d9c12]
  - @osmix/shared@0.0.2
  - @osmix/json@0.0.2
  - @osmix/pbf@0.0.2

## 0.0.1

### Patch Changes

- Initial release
- Updated dependencies
  - @osmix/json@0.0.1
  - @osmix/pbf@0.0.1
  - @osmix/shared@0.0.1
