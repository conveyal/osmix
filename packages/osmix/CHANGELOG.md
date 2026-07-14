# osmix

## 0.3.0

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

- 71cb9f8: Make worker initialization work out of the box and the SharedArrayBuffer story explicit. Add `getOsmixCapabilities()`, `canShareArrayBuffers()`, `remote.mode`, an `inProcess` option, and an `osmix/worker` subpath export. Fix the published default worker URL (pointed at a nonexistent `.ts` file in dist), a browser `process.env` ReferenceError, and a Node 20 crash on import. `createRemote()` now throws a clear error in environments without Web Workers instead of silently running on the calling thread. Removes `SUPPORTS_SHARED_ARRAY_BUFFER`, `DEFAULT_WORKER_COUNT`, and `SUPPORTS_STREAM_TRANSFER` exports.

### Patch Changes

- Updated dependencies [368d103]
- Updated dependencies [368d103]
- Updated dependencies [c7a5a35]
  - @osmix/core@0.2.0
  - @osmix/geojson@0.0.16
  - @osmix/pbf@0.0.10
  - @osmix/shared@0.1.0
  - @osmix/geo@0.1.0
  - @osmix/types@0.1.0
  - @osmix/change@0.1.10
  - @osmix/gtfs@0.0.11
  - @osmix/json@0.0.16
  - @osmix/load@0.0.2
  - @osmix/router@0.0.14
  - @osmix/vt@0.0.14
  - @osmix/geoparquet@0.1.10
  - @osmix/shapefile@0.0.12
  - @osmix/raster@0.0.14

## 0.2.2

### Patch Changes

- Updated dependencies [d67e38d]
  - @osmix/change@0.1.9
  - @osmix/core@0.1.10
  - @osmix/geojson@0.0.15
  - @osmix/geoparquet@0.1.9
  - @osmix/gtfs@0.0.10
  - @osmix/json@0.0.15
  - @osmix/router@0.0.13
  - @osmix/shapefile@0.0.11
  - @osmix/vt@0.0.13

## 0.2.1

### Patch Changes

- Updated dependencies [6144903]
  - @osmix/core@0.1.9
  - @osmix/change@0.1.8
  - @osmix/geojson@0.0.14
  - @osmix/geoparquet@0.1.8
  - @osmix/gtfs@0.0.9
  - @osmix/router@0.0.12
  - @osmix/shapefile@0.0.10
  - @osmix/vt@0.0.13

## 0.2.0

### Minor Changes

- 384f9c1: Improve OsmixRemote API with dataset handles

### Patch Changes

- aba4bd8: Fix for nodejs package imports
- Updated dependencies [aba4bd8]
  - @osmix/change@0.1.7
  - @osmix/core@0.1.8
  - @osmix/geojson@0.0.13
  - @osmix/geoparquet@0.1.7
  - @osmix/gtfs@0.0.8
  - @osmix/json@0.0.14
  - @osmix/pbf@0.0.9
  - @osmix/raster@0.0.13
  - @osmix/router@0.0.11
  - @osmix/shapefile@0.0.9
  - @osmix/shared@0.0.13
  - @osmix/vt@0.0.13

## 0.1.7

### Patch Changes

- 2a634cb: Fix publishing
- Updated dependencies [2a634cb]
  - @osmix/geoparquet@0.1.6
  - @osmix/shapefile@0.0.8
  - @osmix/geojson@0.0.12
  - @osmix/change@0.1.6
  - @osmix/raster@0.0.12
  - @osmix/router@0.0.10
  - @osmix/shared@0.0.12
  - @osmix/core@0.1.7
  - @osmix/gtfs@0.0.7
  - @osmix/json@0.0.13
  - @osmix/pbf@0.0.8
  - @osmix/vt@0.0.12

## 0.1.6

### Patch Changes

- 3c8ee95: Fix and simplify package exports
- Updated dependencies [3c8ee95]
  - @osmix/change@0.1.5
  - @osmix/core@0.1.6
  - @osmix/geojson@0.0.11
  - @osmix/geoparquet@0.1.5
  - @osmix/gtfs@0.0.6
  - @osmix/json@0.0.12
  - @osmix/pbf@0.0.7
  - @osmix/raster@0.0.11
  - @osmix/router@0.0.9
  - @osmix/shapefile@0.0.7
  - @osmix/shared@0.0.11
  - @osmix/vt@0.0.11

## 0.1.5

### Patch Changes

- 12728ed: Replace `csv-parse` usage in `@osmix/gtfs` with a browser-friendly shared streaming CSV parser in `@osmix/shared`, adapted from `mafintosh/csv-parser` parsing behavior.
- Updated dependencies [12728ed]
  - @osmix/gtfs@0.0.5
  - @osmix/shared@0.0.10
  - @osmix/change@0.1.4
  - @osmix/core@0.1.5
  - @osmix/geojson@0.0.10
  - @osmix/geoparquet@0.1.4
  - @osmix/json@0.0.11
  - @osmix/pbf@0.0.6
  - @osmix/raster@0.0.10
  - @osmix/router@0.0.8
  - @osmix/shapefile@0.0.6
  - @osmix/vt@0.0.10

## 0.1.4

### Patch Changes

- Updated dependencies [f32e4ee]
  - @osmix/change@0.1.3
  - @osmix/core@0.1.4
  - @osmix/geojson@0.0.9
  - @osmix/geoparquet@0.1.3
  - @osmix/gtfs@0.0.4
  - @osmix/pbf@0.0.6
  - @osmix/shapefile@0.0.5
  - @osmix/shared@0.0.9
  - @osmix/vt@0.0.9
  - @osmix/router@0.0.7
  - @osmix/json@0.0.10
  - @osmix/raster@0.0.9

## 0.1.3

### Patch Changes

- f468db5: Fix publishing (2)
- Updated dependencies [f468db5]
- Updated dependencies [536a3cd]
  - @osmix/change@0.1.2
  - @osmix/core@0.1.3
  - @osmix/geojson@0.0.8
  - @osmix/geoparquet@0.1.2
  - @osmix/gtfs@0.0.3
  - @osmix/json@0.0.9
  - @osmix/pbf@0.0.5
  - @osmix/raster@0.0.8
  - @osmix/router@0.0.6
  - @osmix/shapefile@0.0.4
  - @osmix/shared@0.0.8
  - @osmix/vt@0.0.8

## 0.1.2

### Patch Changes

- 68d6bd8: Fix publishing for packages.
- Updated dependencies [68d6bd8]
  - @osmix/change@0.1.1
  - @osmix/core@0.1.2
  - @osmix/geojson@0.0.7
  - @osmix/geoparquet@0.1.1
  - @osmix/gtfs@0.0.2
  - @osmix/json@0.0.8
  - @osmix/pbf@0.0.4
  - @osmix/raster@0.0.7
  - @osmix/router@0.0.5
  - @osmix/shapefile@0.0.3
  - @osmix/shared@0.0.7
  - @osmix/vt@0.0.7

## 0.1.1

### Patch Changes

- 54fe002: Add fromGeoParquet to OsmixWorker and OsmixRemote
- 4b91a34: Bump sweepline-intersections from 1.5.0 to 2.0.1
- 478f3b1: Add Shapefile support.
- Updated dependencies [2944218]
- Updated dependencies [54fe002]
- Updated dependencies [31fa333]
- Updated dependencies [4b91a34]
- Updated dependencies [31fa333]
- Updated dependencies [2944218]
- Updated dependencies [d4f4b1f]
  - @osmix/change@0.1.0
  - @osmix/geoparquet@0.1.0
  - @osmix/core@0.1.1
  - @osmix/router@0.0.4
  - @osmix/geojson@0.0.6
  - @osmix/shapefile@0.0.2
  - @osmix/vt@0.0.6

## 0.1.0

### Minor Changes

- 29ed376: Routing: make graph transferable

### Patch Changes

- Updated dependencies [803c05c]
- Updated dependencies [cbe4273]
- Updated dependencies [ff40416]
- Updated dependencies [29ed376]
  - @osmix/core@0.1.0
  - @osmix/geojson@0.0.5
  - @osmix/change@0.0.7
  - @osmix/json@0.0.7
  - @osmix/router@0.0.3
  - @osmix/vt@0.0.6

## 0.0.6

### Patch Changes

- 0cd8a2e: Explore patterns for extending Osmix worker
- Updated dependencies [3846a0c]
- Updated dependencies [2c03b6c]
- Updated dependencies [0cd8a2e]
- Updated dependencies [cdab4db]
  - @osmix/change@0.0.6
  - @osmix/core@0.0.6
  - @osmix/vt@0.0.6
  - @osmix/shared@0.0.6
  - @osmix/geojson@0.0.4
  - @osmix/json@0.0.6
  - @osmix/pbf@0.0.3
  - @osmix/raster@0.0.6

## 0.0.5

### Patch Changes

- bb629cf: Simplify raster drawing when geometry is smaller than a pixel
- 345b716: Move functionality outside of the Changeset
- edbb26b: Handle more Relation types
- 45b1802: Add `transformOsmPbfToJson` helper
- 69a36bd: Switch Nodes coordinate storage to Int32Array
- Updated dependencies [bb629cf]
- Updated dependencies [a33a280]
- Updated dependencies [345b716]
- Updated dependencies [edbb26b]
- Updated dependencies [69a36bd]
  - @osmix/raster@0.0.5
  - @osmix/shared@0.0.5
  - @osmix/vt@0.0.5
  - @osmix/core@0.0.5
  - @osmix/change@0.0.5
  - @osmix/geojson@0.0.3
  - @osmix/json@0.0.5
  - @osmix/pbf@0.0.3

## 0.0.4

### Patch Changes

- d001d9a: Refactor to align around new main external API
- Updated dependencies [572cbd8]
- Updated dependencies [d001d9a]
- Updated dependencies [b2f14d3]
- Updated dependencies [4303c40]
  - @osmix/raster@0.0.4
  - @osmix/shared@0.0.4
  - @osmix/geojson@0.0.2
  - @osmix/change@0.0.4
  - @osmix/core@0.0.4
  - @osmix/json@0.0.4
  - @osmix/pbf@0.0.3
  - @osmix/vt@0.0.4

## 0.0.3

### Patch Changes

- Updated dependencies [b4a3ff2]
- Updated dependencies [c0193dd]
  - @osmix/raster@0.0.3
  - @osmix/shared@0.0.3
  - @osmix/core@0.0.3
  - @osmix/json@0.0.3
  - @osmix/vt@0.0.3
  - @osmix/change@0.0.3
  - @osmix/pbf@0.0.2

## 0.0.2

### Patch Changes

- Updated dependencies [33d9c12]
  - @osmix/change@0.0.2
  - @osmix/shared@0.0.2
  - @osmix/core@0.0.2
  - @osmix/json@0.0.2
  - @osmix/pbf@0.0.2
  - @osmix/raster@0.0.2
  - @osmix/vt@0.0.2

## 0.0.1

### Patch Changes

- Create placeholder package for top level Osmix tool.
