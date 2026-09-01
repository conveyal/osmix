# @osmix/load

## 0.1.0

### Minor Changes

- e4785fe: Enable memory-aware loading of Australia-scale PBF data. Core storage and transfers now use the compact
  version 2 representation, node spatial queries use independent indirect all-node and tagged-node indexes, and
  loaders expose Auto, Full, View, and explicit spatial-index selection with structured capacity diagnostics.
  Vector-tile encoders use the tagged-node capability without requiring an all-node index.
- e4785fe: Expose structured typed-buffer and entity-finalization failures across workers, identify safe View-profile
  retries for spatial capacity errors, and show persistent actionable dataset-load diagnostics in Merge.

### Patch Changes

- Updated dependencies [e4785fe]
- Updated dependencies [df04f92]
- Updated dependencies [e4785fe]
- Updated dependencies [8be5c80]
  - @osmix/shared@0.2.0
  - @osmix/core@0.3.0
  - @osmix/json@0.0.17
  - @osmix/pbf@0.0.10
  - @osmix/types@0.1.0

## 0.0.2

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
  - @osmix/pbf@0.0.10
  - @osmix/shared@0.1.0
  - @osmix/types@0.1.0
  - @osmix/json@0.0.16
