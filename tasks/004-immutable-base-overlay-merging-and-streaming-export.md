# Task 004: Keep the base immutable with overlay-based merging and streaming export

## Status

Ready for design validation and implementation.

## Summary

Replace the current repeated “apply changes by rebuilding the entire `Osm` dataset” merge architecture with an immutable base dataset plus a compact, composable overlay of creates, modifications, and deletions. Reads should resolve through the overlay first and fall back to the base. Spatial and tag queries should combine base-index candidates with small overlay indexes while suppressing stale base versions. PBF export should merge the base's sorted entity streams with sorted overlay changes directly into the existing streaming encoder.

The primary goal is to make a very large immutable base, such as Australia, compatible with a much smaller localized patch without allocating another complete copy of the base after every merge stage. The task reduces merge-time peak memory and eliminates repeated index rebuilding. It does **not** make arbitrary Australia-versus-Australia geometric merge workloads safe, and it does not remove the Full all-node-index requirement from algorithms that genuinely need arbitrary node spatial lookup.

## Background and current behavior

The Australia-scale loading work makes it possible to load a large PBF in View mode by omitting the optional all-node spatial index. That addresses the load/inspect/render problem. Merge-time memory remains a separate issue.

The current materialization path is `packages/change/src/apply-changeset.ts`:

1. Create a new empty `Osm`.
2. Iterate every base node, replacing or deleting entities named by the changeset.
3. Append created nodes.
4. Repeat the same full scan for ways and relations.
5. Build all ID, tag, reference, member, bbox, and spatial indexes for the new dataset.

The high-level `merge()` pipeline in `packages/change/src/merge.ts` calls this full materialization after several independent stages:

1. Deduplicate ways in the base, then materialize the base.
2. Deduplicate nodes in the newly materialized base, then materialize it again.
3. Deduplicate ways in the patch, then materialize the patch.
4. Deduplicate nodes in the newly materialized patch, then materialize it again.
5. Generate direct changes, then materialize the base again.
6. Optionally deduplicate final ways, deduplicate final nodes, and create intersections, materializing after each stage.

The worker layer compounds the peak. `OsmixWorker.merge()` replaces the base with `new Osm(mergedOsm.transferables())`, and `OsmixRemote.merge()` then replicates the completed result to compute workers. During parts of this sequence, the worker may retain the original base, patch, active changeset, newly built entity columns, old and new spatial indexes, and transfer descriptors simultaneously.

This architecture is acceptable for small extracts because it is simple and produces a conventional standalone `Osm`. It is unsuitable for a multi-gigabyte base when the patch affects only a tiny fraction of entities.

### Illustrative memory behavior

Assume a 4 GiB resident base and a 25 MiB patch that modifies 10,000 entities.

The current approach may allocate another base-sized set of columns plus temporary grow/compact buffers and spatial indexes merely to represent those 10,000 logical changes. Repeating the operation across several merge stages can create multiple high-water marks even though only one materialized result survives.

The target overlay approach retains:

- one immutable 4 GiB base;
- the 25 MiB patch while it is still needed;
- a compact overlay proportional to the number of changed entities and replacement maps;
- small overlay-only tag/spatial indexes;
- bounded exporter buffers while streaming the final PBF.

The expected memory growth should be approximately O(number of changes), not O(size of base) per merge stage.

## Goals

1. Keep the original base `Osm` buffers immutable and shareable for the entire merge session.
2. Represent creates, modifications, deletions, ID replacements, and provenance in a compact overlay.
3. Allow successive merge/deduplication/intersection stages to compose into the same logical view without rebuilding the base.
4. Preserve correct entity lookup, sorted iteration, tag search, spatial queries, geometry, and relation membership against the logical merged view.
5. Stream a complete, sorted, standards-compliant PBF from base plus overlay without materializing a full merged `Osm`.
6. Preserve managed-worker scheduling, recovery, cancellation, and shared-buffer behavior.
7. Retain a deliberate compatibility path for callers that explicitly need a fully materialized `Osm` on small datasets.
8. Measure and report overlay size, query overhead, export throughput, and peak memory.

## Non-goals

- Do not make View mode sufficient for algorithms that require the all-node spatial capability. Overlay storage and spatial capability selection are orthogonal.
- Do not add OPFS or another disk database as part of this task. That is Task 005 and remains conditional.
- Do not mutate typed-array columns in the base `Osm` in place.
- Do not silently compact the overlay into a new full dataset when it becomes large; that would recreate the peak this task is intended to avoid.
- Do not redesign PBF block encoding, Flatbush internals, or the compact core v2 representation unless a narrowly scoped change is required by the overlay contracts.
- Do not claim arbitrary country-to-country merge support. The intended first target is a large base plus a substantially smaller/localized patch.

## Required product behavior

### Logical reads

For every entity type, lookup by ID must follow these rules:

1. If the overlay contains a deletion tombstone, return “not found.”
2. If the overlay contains a create or modification, return the overlay entity.
3. Otherwise return the base entity.

Example:

```text
Base nodes:          10, 20, 30
Overlay changes:     modify 20, delete 30, create 40
Logical node IDs:    10, 20, 40
get(node/20):        overlay version
get(node/30):        not found
get(node/10):        base version
```

### Referential reads

Way geometry and relation-member traversal must resolve referenced entities through the same logical view. If node 20 is moved by the overlay, a base way that references node 20 must render using the overlay coordinate even if the way itself is unchanged. If node 30 is deleted, geometry must follow an explicit error/omission policy rather than accidentally reading the stale base node.

This is a crucial distinction: suppressing changed entities only at top-level lookup is insufficient. Reference resolution must be overlay-aware throughout geometry, spatial indexing, export, routing, and change algorithms.

### Sorted iteration and export

The logical entity stream must remain ordered by entity type and ascending OSM ID. Within each entity type, use a merge join between:

- the base's sorted iterator; and
- sorted overlay entries.

At each ID:

- emit the base entity when no overlay record exists;
- emit the overlay entity for create/modify;
- emit nothing for delete;
- reject invalid duplicate-create or modify-missing-base states before export.

This makes memory usage independent of total base size. The exporter needs only iterator state, the sorted overlay keys, and normal PBF block buffers.

### Query semantics

Base indexes contain stale positions for modified/deleted entities, so every combined query must suppress them by ID before returning results. Overlay-created and overlay-modified entities must be queried through overlay-specific indexes.

For example, a node moved from Sydney to Melbourne must not appear in a Sydney bbox because the base KD index still contains its old coordinate. It must appear in Melbourne through the overlay KD index.

The combined query is:

```text
logical results =
  base-index results
    minus IDs shadowed by overlay modifications/deletions
  union overlay-index results
```

Apply deterministic ordering after the union so callers receive stable results independent of which layer produced each entity.

## Proposed architecture

Names in this section are recommended, not mandatory. Preserve the responsibilities even if review selects different names.

### 1. Introduce read-only collection contracts

The current `OsmReader` contract exposes concrete `Nodes`, `Ways`, and `Relations` classes. That prevents an overlay-backed implementation from satisfying the interface without pretending to own the base arrays.

Add explicit read-only contracts in `packages/core/src/contracts.ts`, for example:

```ts
interface EntityReader<T> {
  readonly size: number;
  getById(id: number): T | null;
  getByIndex(index: number): T | null;
  search(key: string, value?: string): number[];
  sorted(): Iterable<T>;
}

interface NodeReader extends EntityReader<OsmNode> {
  findIndexesWithinBbox(bbox: GeoBbox2D): number[];
  findIndexesWithinRadius(lon: number, lat: number, km: number): number[];
  getNodeLonLat(input: IdOrIndex): [number, number] | null;
}
```

The exact index-return contract needs careful design because an index meaningful to `Nodes` is not automatically meaningful to a composite overlay. Prefer stable entity IDs or opaque layer-qualified handles at new abstraction boundaries. Avoid exposing an overlay index that can be accidentally passed to the base collection.

Recommended handle shape:

```ts
type EntityHandle =
  { layer: "base"; index: number; id: number } | { layer: "overlay"; index: number; id: number };
```

Keep existing concrete `Osm` APIs working. Introduce adapters and migrate downstream consumers incrementally rather than changing every package in one unreviewable step.

### 2. Add a normalized overlay model

Create an `OsmOverlay` or `OsmDelta` model in `@osmix/change` that owns:

- one immutable base reader;
- per-entity-type maps of create/modify/delete records;
- flattened node and entity replacement maps;
- provenance/source information currently stored in `OsmChange`;
- a monotonically increasing revision/generation;
- lazily rebuilt overlay-only tag and spatial indexes;
- cached sorted overlay IDs per entity type;
- statistics and estimated resident bytes.

Do not store a chain of overlapping changesets indefinitely. Normalize writes on insertion:

| Existing overlay state | New operation        | Normalized result                               |
| ---------------------- | -------------------- | ----------------------------------------------- |
| none                   | create               | create                                          |
| none                   | modify existing base | modify, preserving base as `oldEntity`          |
| none                   | delete existing base | delete, preserving base as `oldEntity`          |
| create                 | modify               | create with updated entity                      |
| create                 | delete               | remove overlay entry entirely                   |
| modify                 | modify               | one modify with original base `oldEntity`       |
| modify                 | delete               | delete with original base `oldEntity`           |
| delete                 | create same ID       | reject or require an explicit replace operation |

This keeps lookup O(1) and prevents a long workflow from accumulating multiple versions of the same entity.

### 3. Add an overlay-backed logical reader

Implement an `OverlayOsmReader` that presents base plus normalized overlay as one logical dataset. It should expose:

- overlay-first ID lookup;
- sorted merge iteration;
- overlay-aware reference resolution;
- combined tag search;
- combined bbox/radius/intersection queries;
- logical counts and bbox;
- capability reporting that distinguishes base capabilities from overlay capabilities;
- revision information so encoders and caches can invalidate safely.

The logical bbox can be maintained as a conservative union during editing. Exact shrinkage after deleting an extreme entity can be computed lazily or during export; document whether `bbox()` is exact or conservative at each API boundary.

### 4. Build small overlay-only indexes

Overlay entities are expected to be much smaller than the base, so conventional compact in-memory indexes are acceptable:

- all modified/created nodes need an overlay node KD permutation;
- tagged modified/created nodes need a tagged permutation or a filtered view;
- modified/created ways and relations need bbox indexes computed using overlay-aware references;
- tag reverse indexes cover created/modified entities only;
- shadow sets cover all modified/deleted IDs so stale base candidates can be removed.

Index rebuilds should be proportional to overlay size. Batch invalidations within a merge stage and rebuild once at the stage boundary instead of rebuilding after every individual record.

Record overlay-index build timings and bytes. If the overlay crosses a configurable warning threshold, surface the growth instead of automatically creating a full base copy.

### 5. Make changeset algorithms operate on a reader and write to an overlay

Refactor `OsmChangeset` so its logical base is an `OsmReader`/overlay reader rather than necessarily a concrete `Osm`. Methods such as `getEntity`, `deduplicateNodes`, `deduplicateWays`, and intersection creation must see changes produced by earlier stages.

Recommended execution model:

1. Begin with `OverlayOsmReader(base, emptyOverlay)`.
2. Run a merge stage and collect changes in a stage-local `OsmChangeset`.
3. Validate the stage changes against the current logical reader.
4. Compose/normalize them into the shared overlay.
5. Rebuild only invalidated overlay indexes.
6. Create the next logical-reader revision over the same base and updated overlay.

This replaces each `applyChangesetToOsm()` call in `merge.ts` with overlay composition.

Be careful with algorithms that compare the base and patch while also rewriting references. Replacement maps must be flattened across stage boundaries. A later stage must never reintroduce an ID deleted/replaced by an earlier stage.

### 6. Stream merged PBF output

Generalize `packages/load/src/entity-stream.ts` and `toPbfStream()` to consume a sorted logical entity source, not only concrete `Osm` collections.

Recommended contract:

```ts
interface SortedOsmEntitySource {
  readonly header: OsmPbfHeaderBlock;
  sortedNodes(): Iterable<OsmNode>;
  sortedWays(): Iterable<OsmWay>;
  sortedRelations(): Iterable<OsmRelation>;
}
```

Both `Osm` and `OverlayOsmReader` can implement or adapt to this contract. The existing block/PBF transforms should remain unchanged.

Export validation must run before or during streaming:

- no emitted duplicate IDs per entity type;
- every create/modify/delete transition is legal;
- way refs expose OSM IDs, not internal indexes;
- relation members preserve type/ref/role ordering;
- deleted entities are omitted;
- modified entities are emitted once at their sorted position;
- created negative or positive IDs follow the library's existing ID policy;
- output remains readable by `fromPbf()` and semantic hashes match a materialized reference result on small fixtures.

For browser downloads, always prefer `toPbfStream()` piped to a writable file handle. Do not call `toPbfBuffer()` for country-scale output because it intentionally collects the complete encoded PBF into a contiguous `Uint8Array`.

### 7. Preserve an explicit materialization API

Some external callers need a standalone `Osm` after applying a changeset. Keep `applyChangesetToOsm()` as a compatibility/materialization path, or rename the new behavior while retaining the old export.

Recommended APIs:

```ts
// Low-memory logical view; preferred for Merge.
const overlay = applyChangesetToOverlay(changeset);

// Explicit O(N) materialization for callers that accept the cost.
const osm = materializeOsm(overlay, { spatialIndexes: "full" });
```

The expensive API should be named and documented as materializing. It should accept an explicit spatial-index selection rather than always building all indexes.

### 8. Integrate with the managed worker pool

Keep the immutable base dataset registered under its original ID. Register the active overlay under a separate overlay/session ID.

The control worker should own overlay mutations and changeset composition. Compute workers need a read-only overlay snapshot for tiles and inspection. Because overlays are expected to be small, the first implementation may replicate compact overlay entities and tombstone/replacement arrays by structured clone or transferable buffers. Preserve generation numbers so a compute worker never answers a request using a stale overlay revision.

Required worker behaviors:

- overlay mutation runs on the control lane with `retry: "never"`;
- read-only tile/query calls can run on compute lanes after the requested generation is installed;
- a worker restart restores the immutable base using existing descriptors/restorers, then reinstalls the latest overlay snapshot;
- rename and export preserve base ID, overlay ID, and logical output name distinctly;
- cancellation never leaves a half-committed overlay revision visible;
- deletion/disposal releases overlay indexes and snapshots without deleting the persistent base source;
- base and patch lifecycle remains explicit; deleting a patch after merge must not remove entities already copied into the overlay.

Add `OsmixRemote`/`OsmixWorker` APIs around logical datasets rather than overloading the existing dataset ID ambiguously. Example names:

- `createOverlay(baseId, overlayId)`;
- `applyChangesetToOverlay(overlayId)`;
- `getOverlayInfo(overlayId)`;
- `exportOverlayToPbf(overlayId, writable)`;
- `disposeOverlay(overlayId)`.

### 9. Update Merge UI state

Merge should display the base file as immutable and the active result as a logical overlay. Applying a reviewed stage should advance the overlay revision, not replace the base `Osm` atom.

UI information should include:

- base dataset name and load profile;
- overlay revision;
- create/modify/delete counts by entity type;
- overlay resident bytes and index bytes;
- whether the patch is still retained;
- whether export can stream directly to a file;
- an explicit warning when the operation still requires Full.

Undo is not required for the first version, but the data model should not preclude it. A revisioned overlay can retain stage metadata while storing only the normalized current entity state. If full undo is later required, persist stage deltas separately from the normalized lookup maps.

## Implementation phases

### Phase 0: Baselines and invariants

1. Add a benchmark fixture representing a large logical base with a small patch without checking a large PBF into automated tests.
2. Instrument current merge stages with resident typed-buffer estimates and phase timings.
3. Record peak behavior for Monaco plus a synthetic larger base.
4. Write invariants for lookup precedence, sorted iteration, reference resolution, and overlay normalization.
5. Document the exact acceptance scenario: Australia Full if it fits on the test machine plus a small regional patch. Australia in View remains non-mergeable because deduplication needs all-node lookup.

### Phase 1: Reader contracts and sorted overlay export

1. Introduce read-only collection/entity-source interfaces.
2. Adapt concrete `Osm` without changing behavior.
3. Implement normalized overlay maps and overlay-first ID lookup.
4. Implement sorted merge iterators for nodes, ways, and relations.
5. Make `toPbfStream()` accept the logical source.
6. Differentially compare streamed output with `applyChangesetToOsm()` on small fixtures.

This phase can deliver value independently: users can review a changeset and export a merged PBF without building a second full in-memory dataset, even before every interactive query is overlay-aware.

### Phase 2: Overlay-aware tags, geometry, and spatial queries

1. Add shadow sets and overlay tag indexes.
2. Add overlay node, way, and relation spatial indexes.
3. Make geometry/reference traversal use the logical reader.
4. Migrate VT, Shortbread, raster, inspection, and selected-entity rendering to reader contracts.
5. Add revision-aware encoder/tile caches.

### Phase 3: Compose the multi-stage merge pipeline

1. Make `OsmChangeset` accept the logical reader.
2. Replace intermediate materializations with overlay composition.
3. Flatten replacement maps across stages.
4. Validate stage commits atomically.
5. Retain explicit materialization only for compatibility and small-data workflows.

### Phase 4: Worker and Merge integration

1. Add overlay lifecycle APIs to worker/remote.
2. Replicate immutable base descriptors and compact overlay snapshots independently.
3. Restore overlay generations after worker restart.
4. Update Merge state and progress reporting.
5. Stream downloads directly from the logical reader.
6. Add memory diagnostics and warnings for overlay growth.

### Phase 5: Optimization and stabilization

1. Profile hot lookup paths and avoid repeated object materialization.
2. Replace object maps with sorted/typed compact structures only where measurements justify it.
3. Consider incremental overlay-index updates if full overlay rebuild time becomes material.
4. Document public APIs, complexity, and remaining Full requirements.
5. Add a consolidated changeset.

## Testing plan

### Unit tests

- Every create/modify/delete normalization transition in the table above.
- Invalid transitions: create existing ID, modify missing ID, delete missing ID, replacement cycles, and ID collisions.
- Overlay-first node/way/relation lookup.
- Sorted iteration with changes before, between, and after base IDs.
- Empty base, empty overlay, all-deleted type, and overlay-only dataset.
- Modified entity retains original `oldEntity` across multiple stages.
- Way geometry uses modified node coordinates even when the way remains in the base.
- Deleted/missing referenced nodes produce the documented strict behavior.
- Relation traversal sees modified/deleted members correctly.
- Tag search removes stale base matches and adds overlay matches.
- Bbox/radius queries remove stale base geometry and include moved/created overlay geometry.
- Antimeridian, poles, equal-distance ties, and inclusive bbox boundaries.
- Overlay bbox behavior when deleting an extreme entity.
- Replacement maps flatten chains and reject cycles.

### Differential tests

For randomized small datasets and randomized legal changesets:

1. Build a logical overlay.
2. Materialize the same changes with the existing `applyChangesetToOsm()` reference path.
3. Compare every entity by type and ID.
4. Compare sorted iteration.
5. Compare tag searches.
6. Compare bbox/radius/intersection queries.
7. Export both to PBF, reload both, and compare semantic content hashes.

Keep the old materialization implementation available as a test oracle until parity is well established.

### Worker tests

- Overlay creation, mutation, export, disposal, and generation changes.
- Control-worker mutation cannot be retried after partial failure.
- Compute workers receive the latest complete generation.
- Worker restart restores base then overlay.
- Rename does not confuse base storage ID, overlay session ID, and output hash/name.
- Cancellation leaves the previous overlay generation intact.
- Empty overlays and empty entity-type indexes replicate with shared-buffer rules intact.

### Merge app tests

- Applying a reviewed changeset advances overlay stats without replacing the base.
- Map tiles and entity inspection reflect modifications and deletions immediately.
- Full-required controls remain gated for a View base.
- Streaming download never calls the full-buffer export path.
- Clearing a patch after overlay composition does not remove merged creates/modifications.
- Activity reports overlay stage timings and memory growth.
- Errors remain attached to the correct base/patch/result slot.

### Performance and manual tests

- Monaco base plus patch: parity with the existing pipeline.
- Synthetic large base plus small patch: demonstrate memory proportional to overlay size.
- Australia Full plus a localized patch on a machine where Full passes preflight: complete the enabled merge stages and export without allocating a second full base.
- Reload the exported PBF and verify entity counts, representative entities, tag search, and content semantics.
- Record base resident bytes, patch bytes, overlay bytes, maximum worker memory if available, phase timings, export throughput, and final file size.

## Acceptance criteria

- The base `Osm` transfer buffers retain object identity and are never rewritten/replaced during overlay merge stages.
- No merge stage calls `applyChangesetToOsm()` or otherwise constructs a full replacement unless the caller explicitly requests materialization.
- Creates, modifications, deletions, replacement maps, tag search, geometry, relations, and spatial queries match materialized reference results on automated fixtures.
- PBF export is entity-sorted, streaming, reloadable, and semantically equivalent to reference materialization.
- Peak additional typed-buffer memory for a small patch is bounded by the patch/overlay/index/export working set rather than the base size.
- Managed worker restart and replication preserve the latest committed overlay generation.
- View datasets remain clearly gated for Full-only merge algorithms; the task does not weaken capability checks.
- Existing public materialization behavior remains available and documented.
- All affected workspaces and dependents pass format, lint, typecheck, tests, dependency checks, root tests, and Node smoke verification.

## Risks and mitigations

### Risk: concrete collection APIs leak through `OsmReader`

Mitigation: introduce narrow read contracts and adapters first. Migrate one consumer at a time. Do not make overlay collections inherit from concrete typed-array collections.

### Risk: stale base spatial results leak modified geometry

Mitigation: maintain explicit shadow-ID sets for every modified/deleted entity and filter base candidates before unioning overlay candidates. Add moved-entity regression tests.

### Risk: reference resolution bypasses the overlay

Mitigation: centralize logical entity/reference resolution. Prohibit geometry code from reaching directly into base node IDs when operating on an overlay reader.

### Risk: overlay becomes country-sized

Mitigation: report overlay bytes/counts and warn. Do not silently materialize. Treat very large overlays as a product boundary that may require Task 005 or a native/server workflow.

### Risk: worker snapshots race with mutations

Mitigation: use immutable committed overlay generations. Compute workers install a complete generation and requests declare/observe the generation they require.

### Risk: export discovers invalid changes late

Mitigation: validate overlay transitions at composition time and run a lightweight referential/export preflight before writing. Surface the failing entity ID and rule.

## Likely files and packages

- `packages/core/src/contracts.ts` and `packages/core/src/index.ts`
- `packages/change/src/changeset.ts`
- `packages/change/src/apply-changeset.ts`
- `packages/change/src/merge.ts`
- new overlay reader/model files under `packages/change/src/` or a separately justified low-level package
- `packages/load/src/entity-stream.ts` and `packages/load/src/pbf.ts`
- `packages/vt`, `packages/shortbread`, and `packages/raster` reader consumers
- `packages/osmix/src/worker.ts`, `remote.ts`, and worker-pool recovery tests
- `apps/merge/src/workers/osm.worker.ts`
- `apps/merge/src/lib/merge-remote.ts`
- `apps/merge/src/blocks/merge.tsx`, state, hooks, file info, and Activity UI
- package READMEs, Merge README, changeset, and a manual large-merge checklist

## Handoff notes

Start with Phase 1 and preserve the current materialization code as the differential oracle. Avoid attempting the entire interactive overlay surface in one change. A first pull request that introduces contracts, normalized overlay lookup, sorted iteration, and streaming PBF parity is independently reviewable and materially reduces export memory. Follow with spatial/tag query composition and then worker/UI integration.

When proposing API names, include examples for both low-memory overlay use and explicit materialization. Reviewers should be able to tell from a call site whether an operation is O(number of changes), O(size of base), or requires Full spatial capabilities.
