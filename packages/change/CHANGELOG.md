# @osmix/change

## 0.2.1

### Patch Changes

- Add `isDeepEqual` to `@osmix/types/utils`: deep equality for primitives, arrays and plain objects, which throws a `TypeError` for other objects such as typed arrays and maps. Entity equality, merge plans and the worker's changeset filters use it instead of `dequal`, which is no longer a dependency of `@osmix/types`, `@osmix/change` or `osmix`.

- `@types/geojson` is now a dependency instead of a devDependency of the packages whose published type declarations import `geojson`, so TypeScript consumers no longer have to install it themselves.

- Updated dependencies:
  - @osmix/core@0.3.1
  - @osmix/geo@0.2.0
  - @osmix/router@0.1.1
  - @osmix/types@0.3.0

## 0.2.0

### Minor Changes

- 66eb7cd: **Breaking:** an `OsmChangeset`'s `nodeChanges`, `wayChanges` and `relationChanges` (`OsmChangeRecords`) are `ChangeRecordTable`s instead of plain objects keyed by ID: read a record with `get(id)`, and iterate with `keys()` and `values()`, which keep the order the objects had. This lets merge plans read untouched imported entities from the patch instead of storing a record for each.

  Merge plans of large imports use far less memory (Washington's 1.48M-entity import: 2.9 GB peak in Node, from 5.3 GB) and plan faster, with the same output. Empty lists in a matching outcome report (`copiedKeys`, `connectedWayIds`, `reasons`) are one shared frozen array: copy a list before changing it.

- 66eb7cd: Matching proposals list `competitors`: proposals from other imported features that cannot apply with them (connections to one base node; copies and removals against one base way). Decisions that include two alternatives or two competitors throw `MergePlanDecisionConflictError`, which names both proposals and the imported points, and `setMergePlanDecisions` now leaves the plan unchanged whenever it throws. Bulk include skips competitors and never includes a way removal.
- 66eb7cd: Add `dropImportedKeys` to merge plan options: imported keys, or prefixes ending in `*`, that never reach base data. Identical-point and way merges, connections, crossing snaps and replacement anchors leave them out, and connections whose points differ only in them no longer compete; features the import adds keep them. A copy that selects a dropped key is refused (MP-X4). Merge drops `ext:*`, an OpenSidewalks export's own metadata.
- 66eb7cd: **Breaking:** node merges with an imported point (identical points and crossing snaps) now take the imported values: they replace conflicting base values and may add access and barrier tags, such as a curb ramp's `barrier=kerb`. A merge that would change the base point's grade (layer, level, bridge, tunnel, covered) is a review proposal with reason `grade-change`; no automation level decides it (MP-X1, MP-J1). Crossing IDs now write a coordinate that rounds to zero as `0`, so one crossing reported either side of zero is one proposal.
- 66eb7cd: **Breaking:** imported values win every merge that makes two features one (T24), not only node merges:

  - An exact way reconciliation takes the imported way's values, `name` and routing tags included, and keeps the keys only the base way has. A difference in `surface`, `width`, access or direction no longer keeps the imported way; both ways must still be highways or not, areas or not, and the imported direction supported. An equivalent `oneway` spelling keeps the base's. A reconcile that would change the base way's grade is a review proposal with reason `grade-change` that no automation level decides (MP-X2).
  - A connection merges the imported point's tags into the base node, as an identical-point merge does, and drops the point once nothing references it. Access, barrier and other node routing differences no longer block it; a change of the base node's grade is a review proposal (`grade-change`) (MP-M3).
  - Two connections to one base node whose points give a key different values compete: each waits for a person with reason `node-context-conflict`, and `connectionRivals` and plan `rivalries` name the keys (`conflictingKeys`; `sharedWayId` and `sharedWay` are now optional) (MP-M5).
  - The matching outcome credits values a connection writes as copied, and `removedConnectionOrphanNodes` counts tagged points a connection merged.
  - Recommended and Aggressive settle a near tie between two points of one imported way for the tagged one, which candidate evidence marks `sourceTagged`, and include a copy whose own connection to the same base point applies. Pick nearest makes the same choice (MP-M6).

  Within one dataset (Inspect's duplicate scan) both sides must still agree, and copying routing keys still needs review.

- 66eb7cd: **Breaking:** `plan.diagnostics.integrity` lists `PlanIntegrityIssue` objects, each with its `description` and the `entities` it names (planned IDs), instead of strings. A merge plan overview adds the `featureKey` of the imported feature each issue concerns, when there is one.
- 66eb7cd: Add merge plan automation levels (`automation: "conservative" | "recommended" | "aggressive"`, default `"recommended"`). Recommended settles points of one imported way competing for one base point by the clearly nearest; Aggressive also settles other choices between candidates that way and copies routing tags with no competing choice. Decisions the level makes are marked `automated` on proposals, counted in `summary.automated`, and always give way to a person's decisions. Removals and blocked proposals are never decided (MP-M6).
- 66eb7cd: Group the features that need a decision by why they wait (`getMergePlanChoices`, `overview.choices`, `filter.group`), one group per feature, and add a `pick-nearest` bulk action that includes the clearly nearest candidate of each choice (MP-M7). Plan tiles carry each feature's `group`.
- 66eb7cd: Merges are now planned once and applied once. `planMerge(base, patch, options)` records every change as a proposal grouped by imported feature; `setMergePlanDecisions` accepts or rejects proposals and replans only the affected phases; `applyPlan` builds the result in a single pass; `generateMergePlanOsc` writes the plan as osmChange.

  **Breaking:** `merge()` now plans and applies with the Merge app's defaults: imported points at identical coordinates merge into the base, imported ways connect where they cross, and matching runs only when configured. Its options are `MergePlanOptions`:

  | Before (`OsmMergeOptions`)                     | After (`MergePlanOptions`)                        |
  | ---------------------------------------------- | ------------------------------------------------- |
  | `directMerge: true`                            | Always on                                         |
  | `deduplicateNodes`, `deduplicateWays`          | `mergeIdenticalPoints` (default `true`)           |
  | `createIntersections`                          | `createIntersections` (default `true`)            |
  | `conflation: { ..., decisions }`               | `matching: { ... }` plus `decisions` on proposals |
  | `merge(base, patch)` returned `base` unchanged | `merge(base, patch)` runs the default plan        |

  Negative patch IDs are new features and move below the base's lowest ID, so independent imports no longer collide; positive patch IDs still edit the base entity with that ID. `patchIds: "new"` reads every patch ID as new.

- 66eb7cd: **Breaking:** the matching outcome's `unresolvedFeatures` no longer counts imported features with no base feature within the matching radius; `unmatchedFeatures` counts those, and each keeps `unresolved: "unmatched"`. `getMergeMatchingPage` takes a new `"unmatched"` filter, and its `"unresolved"` filter leaves them out.
- 66eb7cd: Add `proposalTagChanges(plan, proposalId)`: the tags of the entity a proposal changes, before and after, by the rule the planner applies for its kind, whether or not the proposal is included yet. Merge plan feature views carry them as `tagChanges`, by proposal ID, and crossing snaps that make two vertices one record them as `merges`.
- 66eb7cd: **Breaking:** the staged merge APIs are removed in favor of merge plans.

  - `generateChangeset`, the `OsmChangeset` stage methods, `OsmChangeset.toJSON`/`fromJson`, and the `@osmix/change/internal/*` exports are gone. Use `planMerge`, `setMergePlanDecisions`, `applyPlan` and `generateMergePlanOsc`; `merge()` plans and applies in one call.
  - The conflation generators and review helpers (`generateConflationChangeset`, `generateConflationArtifacts`, `generateConflationApplicationChangeset`, `buildConflationActionDecision`, `buildConflationSourceDecision`, `resolveConflationActions`, `filterConflationCandidates`, `summarizeConflationCandidates`, `validateConflationDecisions`, `conflationEffectiveStatus`) are gone. Matching actions are plan proposals; `discoverConflationCandidates` remains for inspecting candidates.
  - Types removed with them include `OsmMergeOptions`, `OsmChangesetOptions`, `OsmChanges`, `OsmConflationCandidateFilter` and the `OsmConflationBulk*` types; use `MergePlanOptions`, `PlanDecision` and `MergePlanBulkRequest`.
  - `OsmixWorker` and `OsmixRemote` drop their conflation sessions and `generateChangeset`. Use the plan session methods: `planMerge`, `getMergePlanOverview`, `getMergePlanPage`, `getMergePlanFeature`, `getMergePlanTile`, `getMergeMatchingPage`, `getMergeUncopiedTagPage`, `setMergePlanDecisions`, `applyMergePlanBulk`, `previewMergePlanBulk`, `getMergePlanOsc`, `applyMergePlan` and `clearMergePlan`. Inspect's duplicate fixes use `planDeduplication`.
  - Changesets are no longer serialized. After a worker restart the remote rebuilds each plan from its inputs, options and decisions, and throws `OsmixPlanRecoveryError` if either input changed.

- 66eb7cd: Let one base node take connections from several imported ways (MP-M5): where one imported way ends and the next starts near the same base point, both connect there instead of competing. Two connections to one base node still compete when their points are on one imported way. Conflation candidates list such conflicts in the new `connectionRivals` field, each with the imported way the two points share (`sharedWayId`); connection proposals carry the same as `rivalries`, keyed by competitor, and node tag copies onto one base point get `many-to-one` only when more than one of them can apply.
- 66eb7cd: Stop connecting points of an imported path that runs along a base path (a copy of the same path) to that path: such connections are blocked with `traces-base-way` and no longer compete for the base point. The new `traceLengthMeters` matching option (default 10 m) sets how far the paths must run together. Connections from an imported way's end are no longer flagged for their angle; points along a way keep the 30° bearing check.
- 66eb7cd: Add opt-in way replacement (`allowWayReplacement`, `replacementToleranceMeters`): an imported way that traces base ways can be kept in their place, deleting the base ways while their junctions, tagged points and relation memberships move to the imported way. A replacement that would join highways on different grades at a junction is blocked (`replacement-grade-conflict`).

  A feature's `replaced` outcome now ranks above `merged` and `connected`, so a kept way that also connects reports as replaced. Feature details include `replaces`, the coordinates of the base ways a selected replacement would delete.

### Patch Changes

- 303ca75: Keep unsafe imported-data matching actions blocked when ordinary relation membership adds a review reason. Hard grade, access, geometry, protected-property, and restriction conflicts remain authoritative during individual and filter-wide acceptance. Preserve separate eligibility for property transfer and network attachment so a safe action can still proceed while another is blocked.
- e123e58: Block imported-data matching between conflicting explicit feature classifications, such as a school and a cafe, independently of the tag keys selected for copying. Preserve this hard block for both matching actions during manual and bulk acceptance and when relation membership adds review context. Candidate evidence reports the conflicting base and imported values for inspection in Merge.

  Compare supported classifications on the same key, treating missing or empty values as unknown and generic `yes` as an unspecified positive subtype. Explicit `no` still conflicts with different nonempty values. This matching check does not alter ordinary direct/exact merge rules or authoritative same-ID updates.

- 9b63b65: Report matching outcomes from actual generated changes, with separate tag-copy and network-connection actions, unique unresolved imported features, and intentional skips. Include per-feature and selected-tag details, including values already present or superseded by another copy, and explain retained imports. Identify these as matching-stage results before later intersections can further connect or remap junctions. Preserve existing crossing classifications during intersection creation. Show Merge users a completion summary after successful application and final result refresh, with readable details and a downloadable report. Allow download with unresolved matches and require fresh input selection when starting a new merge.

  Distinguish committed worker mutations from later synchronization failures. Retrying synchronization or display refresh does not reapply the merge, and completion waits until the result is ready to inspect and download.

- 61de06c: Add default-off, explicitly reviewed removal of equivalent imported ways, independently of copying tags and connecting the network. Require a supported retained base counterpart, compatible routing meaning, and verified branch connections; automatic connections alone cannot authorize removal. Block unsafe topology, relation involvement, and unsupported segmentation, and clean only untagged imported points newly orphaned by the selected removal.

  Removal is a `remove-way` proposal in the merge plan (`allowWayRemoval`), blocked until the connections it needs are included; automation levels and bulk choices never include it. The matching outcome lists each applied removal with its source and base IDs, attributes, branch connections and cleanup. Tag-copying and connection-only merges keep their imported geometry.

- 66eb7cd: A merge plan no longer proposes copying tags when no selected tag differs between the imported and base entity. These proposals were always blocked and changed nothing; reviews listed one beside nearly every connection.
- 466adc0: Share one-way normalization between exact reconciliation, fuzzy way matching, and routing. Respect explicit `no`, `false`, and `0` on roundabouts, recognize equivalent supported aliases, and compare reversed geometry consistently. Prevent unsupported values from being treated as direction-equivalent during matching while retaining the router's documented fallback behavior.

  Block fuzzy matches when endpoint geometry cannot establish the orientation needed to compare one-way travel, including closed one-way roundabouts. Bidirectional ways without recognized direction-sensitive tags remain eligible.

- 66eb7cd: Fix planning failing with "Duplicate plan proposal" when a way passes through an imported vertex: both segments beside the vertex report the same crossing, which is now one proposal and one inserted node (MP-J1).
- c269e52: Fix a residual pre-existing exact-node reconciliation defect discovered during the PR #218 review, not introduced by that PR. Validate all proposed sources and their final survivor together before changing tags, references, or entity existence. An untagged base node can no longer absorb conflicting coincident imported cafe and school nodes and silently lose one classification.

  Leave every proposed replacement in an incompatible node group unapplied, including conflicts in incident-way grade/access context and transitive same-dataset diagnostic chains. Compatible groups, authoritative same-ID updates, and existing exact-way descriptive reconciliation retain their established behavior. High-level merges still do not normalize either original input.

- 5ea11cf: Preserve shared junctions during intersection creation by updating every incident way and affected restriction via-node together. Existing bridge and tunnel entrances stay connected, while unsafe shared-junction substitutions leave the original references unchanged and new grade-separated interior crossings remain disconnected. Detached restriction errors identify the via node and participating from/to ways to make source-data corrections easier.
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
  remain blocked. Matching candidates and their evidence are inspectable with `discoverConflationCandidates`;
  merge plans carry the CAR/WALK topology diagnostics, and the Merge app reviews the plan before applying it.

- 66eb7cd: Planning a large import uses much less memory: the crossings phase caches only pairs of ways that cross, unmatched matching candidates share their empty assessments, and the structures built to search the planned state are freed when a plan or replan finishes and before `applyPlan`. Planning Washington's 1.48M-entity sidewalk import drops from 6.5 GB to 4.0 GB of heap.
- Updated dependencies [66eb7cd]
- Updated dependencies [e4785fe]
- Updated dependencies [df04f92]
- Updated dependencies [e4785fe]
- Updated dependencies [66eb7cd]
- Updated dependencies [466adc0]
- Updated dependencies [66eb7cd]
- Updated dependencies [66eb7cd]
- Updated dependencies [66eb7cd]
- Updated dependencies [8be5c80]
- Updated dependencies [cd987f5]
  - @osmix/router@0.1.0
  - @osmix/shared@0.2.0
  - @osmix/core@0.3.0
  - @osmix/types@0.2.0
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
