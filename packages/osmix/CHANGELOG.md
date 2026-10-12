# osmix

## 0.4.0

### Minor Changes

- e4785fe: Enable memory-aware loading of Australia-scale PBF data. Core storage and transfers now use the compact
  version 2 representation, node spatial queries use independent indirect all-node and tagged-node indexes, and
  loaders expose Auto, Full, View, and explicit spatial-index selection with structured capacity diagnostics.
  Vector-tile encoders use the tagged-node capability without requiring an all-node index.
- df04f92: Add a cross-runtime managed worker pool with browser, Bun, and Node worker support,
  cooperative cancellation utilities, a transferable Shortbread feature index, and worker-backed
  consumer integrations.
- 66eb7cd: **Breaking:** an `OsmChangeset`'s `nodeChanges`, `wayChanges` and `relationChanges` (`OsmChangeRecords`) are `ChangeRecordTable`s instead of plain objects keyed by ID: read a record with `get(id)`, and iterate with `keys()` and `values()`, which keep the order the objects had. This lets merge plans read untouched imported entities from the patch instead of storing a record for each.

  Merge plans of large imports use far less memory (Washington's 1.48M-entity import: 2.9 GB peak in Node, from 5.3 GB) and plan faster, with the same output. Empty lists in a matching outcome report (`copiedKeys`, `connectedWayIds`, `reasons`) are one shared frozen array: copy a list before changing it.

- e4785fe: Expose structured typed-buffer and entity-finalization failures across workers, identify safe View-profile
  retries for spatial capacity errors, and show persistent actionable dataset-load diagnostics in Merge.
- 66eb7cd: Matching proposals list `competitors`: proposals from other imported features that cannot apply with them (connections to one base node; copies and removals against one base way). Decisions that include two alternatives or two competitors throw `MergePlanDecisionConflictError`, which names both proposals and the imported points, and `setMergePlanDecisions` now leaves the plan unchanged whenever it throws. Bulk include skips competitors and never includes a way removal.
- 66eb7cd: Add `OsmixRemote.copy(fromId, toId)`, which registers a dataset under a second ID in every worker while keeping the original. SharedArrayBuffer-backed datasets share their buffers, so the copy is free, and replacing or deleting one ID leaves the other intact.
- 66eb7cd: **Breaking:** `Osm.bbox()` and `OsmInfo.bbox` are `null` for a dataset with no nodes.

  Add `renumberNegativeIds` and `negativeIdMap`, which renumber new (negative) IDs after each entity type's highest ID for tools that reject negative IDs, with every way ref and relation member following. Ways, relations and strings beyond what the stored format holds (65,535 refs, members or bytes) now throw `OsmCapacityError`, which names the entity and the limit; the limits and `assertCapacity` are exported. `ResizeableTypedArray` is exported.

- 66eb7cd: Add `dropImportedKeys` to merge plan options: imported keys, or prefixes ending in `*`, that never reach base data. Identical-point and way merges, connections, crossing snaps and replacement anchors leave them out, and connections whose points differ only in them no longer compete; features the import adds keep them. A copy that selects a dropped key is refused (MP-X4). Merge drops `ext:*`, an OpenSidewalks export's own metadata.
- 66eb7cd: Add `OsmixRemote.extract(sourceId, options)`, which extracts a bounding box from a dataset already loaded in the workers into a new dataset. The bbox, strategy and tag filters behave exactly as the `fromPbf` extract options, and the source is left as it is.
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
- 66eb7cd: **Breaking:** make node tag filters safe for routing. Node rules now select only standalone nodes: a tag-filtered load keeps every node that a kept way or relation references, and `pruneUnreferencedNodes` drops the rest after ingestion. `CONVEYAL_EXTRACT_TAG_FILTERS` now keeps only `park_ride` standalone nodes, which makes R5 extracts much smaller. Extracts never remove members from a turn restriction: `simple` and `complete_ways` drop a restriction the bbox cuts, and `smart` completes it. Adds `isRestrictionRelation`.
- 66eb7cd: **Breaking:** remove the deprecated `buildSpatialIndexes` load option. Choose spatial indexes with `loadProfile` (`"auto"`, `"full"`, or `"view"`) or, for an exact selection, `spatialIndexes`. For example, `buildSpatialIndexes: ["way", "relation"]` becomes `spatialIndexes: { nodes: [], ways: true, relations: true }`.
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

- c269e52: Fix a residual pre-existing exact-node reconciliation defect discovered during the PR #218 review, not introduced by that PR. Validate all proposed sources and their final survivor together before changing tags, references, or entity existence. An untagged base node can no longer absorb conflicting coincident imported cafe and school nodes and silently lose one classification.

  Leave every proposed replacement in an incompatible node group unapplied, including conflicts in incident-way grade/access context and transitive same-dataset diagnostic chains. Compatible groups, authoritative same-ID updates, and existing exact-way descriptive reconciliation retain their established behavior. High-level merges still do not normalize either original input.

- 5ea11cf: Preserve shared junctions during intersection creation by updating every incident way and affected restriction via-node together. Existing bridge and tunnel entrances stay connected, while unsafe shared-junction substitutions leave the original references unchanged and new grade-separated interior crossings remain disconnected. Detached restriction errors identify the via node and participating from/to ways to make source-data corrections easier.
- 6978796: Keep matched imported ways and their connecting nodes when copying selected tags onto base features. Property transfer now changes only tag values relative to the ordinary direct/exact merge, including automatic, individual, and filter-wide decisions. This prevents tag-only merges from disconnecting imported branches when network attachment is disabled. Geometry removal is no longer an implicit side effect of copying tags.
- 66eb7cd: Reuse built way and relation spatial indexes. `Ways.buildSpatialIndex()` and `Relations.buildSpatialIndex()` rebuilt their Flatbush trees on every call, so calling `Osm.buildSpatialIndexes()` on a loaded dataset repeated work. They now return the existing index, as node indexes already did.
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
  remain blocked. Matching candidates and their evidence are inspectable with `discoverConflationCandidates`;
  merge plans carry the CAR/WALK topology diagnostics, and the Merge app reviews the plan before applying it.

- 66eb7cd: Planning a large import uses much less memory: the crossings phase caches only pairs of ways that cross, unmatched matching candidates share their empty assessments, and the structures built to search the planned state are freed when a plan or replan finishes and before `applyPlan`. Planning Washington's 1.48M-entity sidewalk import drops from 6.5 GB to 4.0 GB of heap.
- 66eb7cd: Return only the encoded bytes from `writeVtPbf`. It returned the writer's whole backing buffer, so every vector tile ended with unused zero bytes, sometimes nearly doubling its size.
- Updated dependencies [303ca75]
- Updated dependencies [66eb7cd]
- Updated dependencies [e123e58]
- Updated dependencies [e4785fe]
- Updated dependencies [df04f92]
- Updated dependencies [5c624d5]
- Updated dependencies [66eb7cd]
- Updated dependencies [e4785fe]
- Updated dependencies [66eb7cd]
- Updated dependencies [66eb7cd]
- Updated dependencies [66eb7cd]
- Updated dependencies [66eb7cd]
- Updated dependencies [9b63b65]
- Updated dependencies [61de06c]
- Updated dependencies [e938749]
- Updated dependencies [66eb7cd]
- Updated dependencies [66eb7cd]
- Updated dependencies [66eb7cd]
- Updated dependencies [66eb7cd]
- Updated dependencies [66eb7cd]
- Updated dependencies [66eb7cd]
- Updated dependencies [66eb7cd]
- Updated dependencies [466adc0]
- Updated dependencies [66eb7cd]
- Updated dependencies [66eb7cd]
- Updated dependencies [c269e52]
- Updated dependencies [5ea11cf]
- Updated dependencies [66eb7cd]
- Updated dependencies [66eb7cd]
- Updated dependencies [66eb7cd]
- Updated dependencies [66eb7cd]
- Updated dependencies [66eb7cd]
- Updated dependencies [6978796]
- Updated dependencies [66eb7cd]
- Updated dependencies [66eb7cd]
- Updated dependencies [8be5c80]
- Updated dependencies [cd987f5]
- Updated dependencies [66eb7cd]
- Updated dependencies [66eb7cd]
- Updated dependencies [66eb7cd]
- Updated dependencies [66eb7cd]
- Updated dependencies [66eb7cd]
  - @osmix/change@0.2.0
  - @osmix/router@0.1.0
  - @osmix/shared@0.2.0
  - @osmix/core@0.3.0
  - @osmix/load@0.1.0
  - @osmix/vt@0.1.0
  - @osmix/raster@0.1.0
  - @osmix/types@0.2.0
  - @osmix/geojson@0.0.17
  - @osmix/shapefile@0.0.13
  - @osmix/geo@0.1.1
  - @osmix/geoparquet@0.1.11
  - @osmix/gtfs@0.0.12
  - @osmix/json@0.0.17
  - @osmix/pbf@0.0.10

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
