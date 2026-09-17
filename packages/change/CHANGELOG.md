# @osmix/change

## 0.1.11

### Patch Changes

- 303ca75: Keep unsafe imported-data matching actions blocked when ordinary relation membership adds a review reason. Hard grade, access, geometry, protected-property, and restriction conflicts remain authoritative during individual and filter-wide acceptance. Preserve separate eligibility for property transfer and network attachment so a safe action can still proceed while another is blocked.
- e123e58: Block imported-data matching between conflicting explicit feature classifications, such as a school and a cafe, independently of the tag keys selected for copying. Preserve this hard block for both matching actions during manual and bulk acceptance and when relation membership adds review context. Candidate evidence reports the conflicting base and imported values for inspection in Merge.

  Compare supported classifications on the same key, treating missing or empty values as unknown and generic `yes` as an unspecified positive subtype. Explicit `no` still conflicts with different nonempty values. This matching check does not alter ordinary direct/exact merge rules or authoritative same-ID updates.

- 9b63b65: Report matching outcomes from actual generated changes, with separate tag-copy and network-connection actions, unique unresolved imported features, and intentional skips. Include per-feature and selected-tag details, including values already present or superseded by another copy, and explain retained imports. Identify these as matching-stage results before later intersections can further connect or remap junctions. Preserve existing crossing classifications during intersection creation. Show Merge users a completion summary after successful application and final result refresh, with readable details and a downloadable report. Allow download with unresolved matches and require fresh input selection when starting a new merge.

  Distinguish committed worker mutations from later synchronization failures. Retrying synchronization or display refresh does not reapply the merge, and completion waits until the result is ready to inspect and download.

- 61de06c: Add default-off, explicitly reviewed removal of equivalent imported ways, independently of copying tags and connecting the network. Require a supported retained base counterpart, compatible routing meaning, and verified branch connections; automatic connections alone cannot authorize removal. Block unsafe topology, relation involvement, and unsupported segmentation, and clean only untagged imported points newly orphaned by the selected removal.

  Expose decision-dependent removal plans through the matching APIs and worker review, retain them in generated outcome reports and recovery, and show source/base IDs, attributes, branch prerequisites, and cleanup before applying in Merge. Automatic and bulk actions never select removal. Existing tag-copying and connection-only callers retain their imported geometry.

- 06354ea: Resolve scheduled matching actions consistently across row controls, bulk decisions, saved review state, and generation. Let users choose Copy tags and Connect network independently while preserving the other choice. Show the current schedule separately from discovery eligibility, make skipping schedule neither action, and clarify that automatic actions are staged for preview before applying changes.
- 466adc0: Share one-way normalization between exact reconciliation, fuzzy way matching, and routing. Respect explicit `no`, `false`, and `0` on roundabouts, recognize equivalent supported aliases, and compare reversed geometry consistently. Prevent unsupported values from being treated as direction-equivalent during matching while retaining the router's documented fallback behavior.

  Block fuzzy matches when endpoint geometry cannot establish the orientation needed to compare one-way travel, including closed one-way roundabouts. Bidirectional ways without recognized direction-sensitive tags remain eligible.

- 875c4f9: Add a supported changeset JSON round trip that preserves integrity validation using verified base and patch input context. Recompute inherited issues from matching original input snapshots instead of trusting serialized issue exemptions. Keep safe legacy changes-only snapshots usable, and explain when missing source context requires restoring a newer snapshot or regenerating the changeset.
- c269e52: Fix a residual pre-existing exact-node reconciliation defect discovered during the PR #218 review, not introduced by that PR. Validate all proposed sources and their final survivor together before changing tags, references, or entity existence. An untagged base node can no longer absorb conflicting coincident imported cafe and school nodes and silently lose one classification.

  Leave every proposed replacement in an incompatible node group unapplied, including conflicts in incident-way grade/access context and transitive same-dataset diagnostic chains. Compatible groups, authoritative same-ID updates, and existing exact-way descriptive reconciliation retain their established behavior. High-level merges still do not normalize either original input.

- 5ea11cf: Preserve shared junctions during intersection creation by updating every incident way and affected restriction via-node together. Existing bridge and tunnel entrances stay connected, while unsafe shared-junction substitutions leave the original references unchanged and new grade-separated interior crossings remain disconnected. Detached restriction errors identify the via node and participating from/to ways to make source-data corrections easier.
- cd66e74: Keep alternative targets together for each imported feature and enforce one target with scheduled matching actions. Add a source-level decision helper that replaces a target or leaves the feature unmatched while preserving unrelated choices. Allow older conflicting reviews to be corrected one feature at a time; generation stays blocked until all conflicts are resolved. Reject invalid replacements before changing decisions or invalidating previews, and support grouped pagination with all alternatives visible. Let Merge users return from reconciliation, a cumulative preview before application, or generation failure to correct matching choices without reloading their original inputs.
- 3c51084: Reject defined `conflation` options passed to ordinary `generateChangeset()` instead of returning a preview that silently omits requested matching. Export `OsmChangesetOptions` for the supported ordinary stages and retain runtime validation for JavaScript, worker/remote calls, and structurally wider typed objects. Undefined matching options remain equivalent to omission.

  The rejection preserves existing generated previews and datasets and directs callers to `generateConflationChangeset()` or `merge()`. Supported direct matching APIs and worker/remote generation from reviewed matching sessions retain their existing behavior.

- 6978796: Keep matched imported ways and their connecting nodes when copying selected tags onto base features. Property transfer now changes only tag values relative to the ordinary direct/exact merge, including automatic, individual, and filter-wide decisions. This prevents tag-only merges from disconnecting imported branches when network attachment is disabled. Geometry removal is no longer an implicit side effect of copying tags.
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
  - @osmix/shared@0.2.0
  - @osmix/core@0.3.0
  - @osmix/types@0.1.1
  - @osmix/geo@0.1.1

## 0.1.10

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
  - @osmix/geo@0.1.0
  - @osmix/types@0.1.0

## 0.1.9

### Patch Changes

- d67e38d: Bump dependencies to latest majors and adopt TypeScript 7 RC
- Updated dependencies [d67e38d]
  - @osmix/core@0.1.10

## 0.1.8

### Patch Changes

- Updated dependencies [6144903]
  - @osmix/core@0.1.9

## 0.1.7

### Patch Changes

- aba4bd8: Fix for nodejs package imports
- Updated dependencies [aba4bd8]
  - @osmix/core@0.1.8
  - @osmix/shared@0.0.13

## 0.1.6

### Patch Changes

- 2a634cb: Fix publishing
- Updated dependencies [2a634cb]
  - @osmix/shared@0.0.12
  - @osmix/core@0.1.7

## 0.1.5

### Patch Changes

- 3c8ee95: Fix and simplify package exports
- Updated dependencies [3c8ee95]
  - @osmix/core@0.1.6
  - @osmix/shared@0.0.11

## 0.1.4

### Patch Changes

- Updated dependencies [12728ed]
  - @osmix/shared@0.0.10
  - @osmix/core@0.1.5

## 0.1.3

### Patch Changes

- f32e4ee: General cleanup
- Updated dependencies [f32e4ee]
  - @osmix/core@0.1.4
  - @osmix/shared@0.0.9

## 0.1.2

### Patch Changes

- f468db5: Fix publishing (2)
- Updated dependencies [f468db5]
  - @osmix/core@0.1.3
  - @osmix/shared@0.0.8

## 0.1.1

### Patch Changes

- 68d6bd8: Fix publishing for packages.
- Updated dependencies [68d6bd8]
  - @osmix/core@0.1.2
  - @osmix/shared@0.0.7

## 0.1.0

### Minor Changes

- 2944218: Add augmented diffs support following the Overpass API Augmented Diffs format.

  - `OsmChange` type now includes an optional `oldEntity` field that captures the previous state of an entity for "modify" and "delete" operations
  - `generateOscChanges()` now defaults to producing augmented diffs with `<old>` and `<new>` sections for modifications, and `<old>` sections for deletions
  - Added `OscOptions.augmented` option to control whether augmented diffs are generated (defaults to `true`)
  - Updated merge app UI to display side-by-side old/new comparison for modifications

### Patch Changes

- 4b91a34: Bump sweepline-intersections from 1.5.0 to 2.0.1
- 2944218: Export Augmented Diffs
- Updated dependencies [d4f4b1f]
  - @osmix/core@0.1.1

## 0.0.7

### Patch Changes

- ff40416: Refactor main `osmix` lib external APIs
- Updated dependencies [803c05c]
- Updated dependencies [cbe4273]
- Updated dependencies [ff40416]
- Updated dependencies [29ed376]
  - @osmix/core@0.1.0

## 0.0.6

### Patch Changes

- 3846a0c: Integrate geographic spatial indexing libraries
- Updated dependencies [3846a0c]
- Updated dependencies [0cd8a2e]
- Updated dependencies [cdab4db]
  - @osmix/core@0.0.6
  - @osmix/shared@0.0.6

## 0.0.5

### Patch Changes

- 345b716: Move functionality outside of the Changeset
- 69a36bd: Switch Nodes coordinate storage to Int32Array
- Updated dependencies [bb629cf]
- Updated dependencies [a33a280]
- Updated dependencies [edbb26b]
- Updated dependencies [69a36bd]
  - @osmix/shared@0.0.5
  - @osmix/core@0.0.5

## 0.0.4

### Patch Changes

- d001d9a: Refactor to align around new main external API
- 4303c40: Refactor core Osmix index to prepare for future work
- Updated dependencies [572cbd8]
- Updated dependencies [d001d9a]
- Updated dependencies [4303c40]
  - @osmix/shared@0.0.4
  - @osmix/core@0.0.4

## 0.0.3

### Patch Changes

- Updated dependencies [b4a3ff2]
- Updated dependencies [c0193dd]
  - @osmix/shared@0.0.3
  - @osmix/core@0.0.3
  - @osmix/json@0.0.3
  - @osmix/pbf@0.0.2

## 0.0.2

### Patch Changes

- 33d9c12: Modify types to take Uint8Array<ArrayBufferLike> for compatiblity
- Updated dependencies [33d9c12]
  - @osmix/shared@0.0.2
  - @osmix/core@0.0.2
  - @osmix/json@0.0.2
  - @osmix/pbf@0.0.2

## 0.0.1

### Patch Changes

- Initial release
- Updated dependencies
  - @osmix/core@0.0.1
  - @osmix/json@0.0.1
  - @osmix/pbf@0.0.1
  - @osmix/shared@0.0.1
