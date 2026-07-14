---
"@osmix/change": patch
"@osmix/core": minor
"@osmix/geojson": patch
"@osmix/gtfs": patch
"@osmix/json": patch
"@osmix/load": patch
"@osmix/pbf": patch
"@osmix/router": patch
"@osmix/shared": patch
"@osmix/shortbread": patch
"@osmix/test-utils": patch
"@osmix/vt": patch
"osmix": minor
---

Harden parsing, loading, changeset generation, worker orchestration, and package verification across Osmix.

- `@osmix/pbf`, `@osmix/json`, and `@osmix/load` now validate PBF framing and decompression limits, normalize every supported input form, apply timestamp granularity consistently, translate tags before filtering, remove dangling filtered references, and build every requested spatial index.
- `@osmix/core` now returns `null` for unknown node-coordinate lookups, safely handles incomplete geometry, caches relation-to-way membership, and avoids repeated ID lookups and per-entity object allocation during sorted iteration.
- `@osmix/change` now preserves relation references during deduplication, escapes OSC XML attributes, applies changesets non-destructively, allocates collision-free IDs for empty or unsorted data, and resolves pending intersection geometry safely. Its intersection runtime is now vendored and strictly typed, removing the upstream test/build dependency graph.
- `osmix` now preserves sliced typed-array views during transfer, disposes and terminates owned workers reliably, uses collision-safe worker registries, and supports all documented PBF input forms across local and remote APIs.
- `@osmix/geojson`, `@osmix/vt`, and `@osmix/shortbread` now consume nullable or read-only geometry data without aliasing or mutation hazards.
- `@osmix/gtfs` and `@osmix/router` documentation now uses the current archive, routing, transfer, and distance APIs.
- `@osmix/shared` and `@osmix/test-utils` add executable package smoke coverage for byte streams and checked-in fixtures.
- Public package examples are classified as compilable or schematic and are checked against current exports and argument types.
