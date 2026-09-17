# @osmix/router

## 0.0.15

### Patch Changes

- 466adc0: Share one-way normalization between exact reconciliation, fuzzy way matching, and routing. Respect explicit `no`, `false`, and `0` on roundabouts, recognize equivalent supported aliases, and compare reversed geometry consistently. Prevent unsupported values from being treated as direction-equivalent during matching while retaining the router's documented fallback behavior.

  Block fuzzy matches when endpoint geometry cannot establish the orientation needed to compare one-way travel, including closed one-way roundabouts. Bidirectional ways without recognized direction-sensitive tags remain eligible.

- 8be5c80: Allow Osmix to use its ArrayBuffer fallback when SharedArrayBuffer is unavailable, so browser
  applications no longer need to install a global SharedArrayBuffer shim.
- cd987f5: Preserve input topology during merges, conservatively reconcile compatible patch entities with the base,
  validate routing-sensitive references, and insert multiple intersections in way order. Within-file duplicate
  scans in the Merge app are now diagnostic only; regenerate older merged PBFs from their source inputs. Correct
  the router priority queue so shortest-path searches visit lower-cost states first, and honor the one-way
  direction implied by OSM roundabouts plus reverse one-way (`oneway=-1`) tags.

  Restore the original 1-meter matching behavior as explicit, cross-dataset fuzzy conflation for imported data.
  Callers select transferable properties independently from patch-network attachment; exact merge behavior
  remains the default. Unique, high-confidence pedestrian and one-to-one-way matches can apply automatically,
  while routing properties, motor roads, ambiguity, relation involvement, and uncertain geometry require review.
  Grade conflicts, restrictions, protected tags, dangling references, way collapse, and base-topology rewrites
  remain blocked. Add public candidate/evidence/decision APIs, restart-safe worker review sessions, CAR/WALK
  topology diagnostics, and a dedicated Merge-app review step.

  Add atomic, filter-wide conflation decisions with worker-computed previews. The Merge app can transfer
  properties, attach networks, or reject every candidate matching the current filters across all pages, while
  showing skipped ambiguity and overwritten decisions before confirmation. Accepted candidates now have a stable
  summary and filter status, and complete bulk decision snapshots remain restart-safe.

- Updated dependencies [e4785fe]
- Updated dependencies [df04f92]
- Updated dependencies [e4785fe]
- Updated dependencies [466adc0]
- Updated dependencies [8be5c80]
  - @osmix/core@0.3.0
  - @osmix/types@0.1.1
  - @osmix/geo@0.1.1

## 0.0.14

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
  - @osmix/geo@0.1.0
  - @osmix/types@0.1.0

## 0.0.13

### Patch Changes

- Updated dependencies [d67e38d]
  - @osmix/core@0.1.10

## 0.0.12

### Patch Changes

- Updated dependencies [6144903]
  - @osmix/core@0.1.9

## 0.0.11

### Patch Changes

- aba4bd8: Fix for nodejs package imports
- Updated dependencies [aba4bd8]
  - @osmix/core@0.1.8
  - @osmix/shared@0.0.13

## 0.0.10

### Patch Changes

- 2a634cb: Fix publishing
- Updated dependencies [2a634cb]
  - @osmix/shared@0.0.12
  - @osmix/core@0.1.7

## 0.0.9

### Patch Changes

- 3c8ee95: Fix and simplify package exports
- Updated dependencies [3c8ee95]
  - @osmix/core@0.1.6
  - @osmix/shared@0.0.11

## 0.0.8

### Patch Changes

- Updated dependencies [12728ed]
  - @osmix/shared@0.0.10
  - @osmix/core@0.1.5

## 0.0.7

### Patch Changes

- Updated dependencies [f32e4ee]
  - @osmix/core@0.1.4
  - @osmix/shared@0.0.9

## 0.0.6

### Patch Changes

- f468db5: Fix publishing (2)
- Updated dependencies [f468db5]
  - @osmix/core@0.1.3
  - @osmix/shared@0.0.8

## 0.0.5

### Patch Changes

- 68d6bd8: Fix publishing for packages.
- Updated dependencies [68d6bd8]
  - @osmix/core@0.1.2
  - @osmix/shared@0.0.7

## 0.0.4

### Patch Changes

- Updated dependencies [d4f4b1f]
  - @osmix/core@0.1.1

## 0.0.3

### Patch Changes

- 29ed376: Routing: make graph transferable
- Updated dependencies [803c05c]
- Updated dependencies [cbe4273]
- Updated dependencies [ff40416]
- Updated dependencies [29ed376]
  - @osmix/core@0.1.0

## 0.0.2

### Patch Changes

- cdab4db: Add router
- Updated dependencies [3846a0c]
- Updated dependencies [0cd8a2e]
- Updated dependencies [cdab4db]
  - @osmix/core@0.0.6
  - @osmix/shared@0.0.6
