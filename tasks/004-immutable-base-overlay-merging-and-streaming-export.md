# Task 004: Measure merge memory, then stream the merged PBF from the plan

## Status

Step 1 is partly done for large imports (T34, below). Step 2 (streaming export) depends on the rest of step 1. Step 3 is deferred.

### Results so far: large imports (T34, 2026-10-08)

`apps/bench` `plan-memory` measures heap per planner phase in Node. Chromium stores the same plan in about 0.59 of Node's heap, and caps the heap at about 3.7 GB.

| Base + patch (patch entities)  | Node heap after planning | Peak    | Apply                                  |
| ------------------------------ | ------------------------ | ------- | -------------------------------------- |
| Washington, before T34 (1.48M) | 6.50 GB                  | 6.50 GB | crashed the browser tab                |
| Washington, after T34          | 4.01 GB                  | 5.31 GB | 15 s; plans and applies in the browser |
| Seattle, after T34 (2.08M)     | 6.35 GB                  | 8.34 GB | does not fit; Merge refuses it         |

For these imports **planning**, not apply, sets the peak: one or more JS objects per imported entity (change records, proposals, candidates) plus the structures built to search them. Step 2 would not help; the planner's own memory is T34's subject. A structural fix (read the patch as a second read-only layer, with records only for changed entities) is the next step if larger imports must plan in the browser.

## Summary

The original version of this task proposed an immutable base with a composable overlay, so that a merge would not copy the whole base after every stage. The Merge-plan work (commits `05834837` through `8d7bc2b2`) delivered most of that:

- `PlanOverlay` (`packages/change/src/plan/overlay.ts`) holds an immutable base `Osm` plus one change record per changed entity. Reads resolve a record first and fall back to the base. Spatial queries combine the base's packed indexes, for geometry no record touched, with a hash grid of pending geometry.
- Every plan phase (identical points and ways, matching, crossings) reads through the overlay, so a later phase sees what an earlier one decided. Decisions replan only the phases they affect.
- Plans validate before they apply, including routing integrity on the planned state (`OsmChangeset.pendingIntegrityIssues()`), before any build.
- `merge()` is `applyPlan(planMerge(...))`. The dataset is materialized **once**, by `applyChangesetToOsm()` in `applyPlan()` (`packages/change/src/plan/plan.ts`). The old pipeline's repeated whole-base copies are gone.

What remains is that one materialization. `OsmixWorker.applyMergePlan()` builds a complete merged `Osm` with all ID, tag and spatial indexes, replaces the base with it, and then the remote replicates it to compute workers. For a short time the worker holds the base, the patch, the plan and a second base-sized dataset. Export (`toPbfStream()`) needs a concrete `Osm`, so a user cannot download the merged result without that build.

Nobody has measured whether that single peak is what prevents a large merge. This task measures first, and only then removes the peak for the export path.

## Goals

1. Measure peak memory and phase timings for planning and applying a small patch into a large base.
2. If apply is the failing or dominant step, export the merged PBF directly from a `MergePlan` by streaming the base and the plan's change records in sorted order, without building a merged `Osm`.
3. Keep `applyPlan()` and `applyChangesetToOsm()` unchanged. They are the materializing path and the test oracle.

## Non-goals

- Overlay-aware tile encoders, inspection, routing or search after apply. See "Deferred".
- New `OsmReader` collection contracts in `@osmix/core`. The streaming export only needs a sorted entity source.
- Worker overlay sessions, overlay generations, or compute-worker overlay replication.
- Making View-mode datasets mergeable. Planning needs the all-node spatial index; capability checks stay as they are.
- Disk-backed storage (Task 005).

## Step 1: Measure

Record, for each scenario:

- base load time and resident typed-buffer bytes (`Osm.transferables()` sizes are a good estimate);
- patch bytes;
- `planMerge()` time and the growth in resident bytes during planning (change records, pending-geometry grid, matching state);
- `applyPlan()` time and peak resident bytes, split into materialization and index build;
- time and peak for `toPbfStream()` of the result;
- the JS heap limit and whether any step failed.

Scenarios:

1. Monaco base with `fixtures/monaco-merge-patch.geojson`: the baseline.
2. A mid-size base with a real localized patch, for example `fixtures/seattle.osm.pbf` with `fixtures/seattle-osw.pbf`, or the Yakima or Spokane pairs.
3. Australia (`fixtures/australia-260716.osm.pbf`) loaded Full with a small regional patch, on a machine where Full passes preflight. Do not check large fixtures into automated tests.

Run the scenarios in Node first (a script under `apps/bench` or a standalone script is enough). Then repeat scenario 3 in the Merge app to include worker replication and browser heap limits.

Report the results in this file and decide:

- If apply fits comfortably in the target scenario, stop. Close this task and record the numbers. Update Task 005's go/no-go inputs.
- If apply fails or dominates peak memory while planning fits, do step 2.
- If planning itself fails, step 2 does not help. Record which structure grows (change records, pending-geometry grid, matching candidates) and open a separate task for it.

## Step 2: Stream the merged PBF from the plan

### Sorted entity source

Generalize `packages/load/src/entity-stream.ts` so `toPbfStream()` accepts a sorted entity source, not only an `Osm`:

```ts
interface SortedOsmEntitySource {
  readonly header: OsmPbfHeaderBlock;
  sortedNodes(): Iterable<OsmNode>;
  sortedWays(): Iterable<OsmWay>;
  sortedRelations(): Iterable<OsmRelation>;
}
```

`Osm` adapts to it through `nodes.osmSorted()`, `ways.osmSorted()` and `relations.osmSorted()`. The block and PBF transforms do not change.

### Merge join

Add a function in `@osmix/change` that returns a `SortedOsmEntitySource` for a plan, for example `mergePlanEntitySource(plan)`. For each entity type:

1. Sort the change records' IDs once, in canonical OSM order: negative IDs first by increasing absolute value, then non-negative IDs ascending. This matches `Ids.osmSortedEntries()` in `@osmix/core`. Planned crossing nodes use negative IDs, so this ordering matters.
2. Walk the base's `osmSorted()` iterator and the sorted record IDs together. At each ID:
   - no record: emit the base entity;
   - `create` or `modify`: emit the record's entity;
   - `delete`: emit nothing.
3. Reject a `create` whose ID exists in the base, and a `modify` or `delete` whose ID does not. Name the entity and the rule in the error.

Memory is the base iterators, the sorted record ID arrays, and the normal PBF block buffers. Nothing is proportional to the base size.

### Validation

Streaming must refuse what `applyPlan()` refuses:

- plans with `plan.diagnostics.integrity` problems (the same check `applyPlan()` runs before it builds);
- invalid change sequences (above).

`applyChangesetToOsm()` also runs `changeset.assertValidResult()` on the built dataset. Confirm that `pendingIntegrityIssues()` on the planned state covers the same cases, and document any gap. Do not skip a check silently.

### Public API

Keep the cost visible at the call site:

```ts
// O(changes) extra memory; streams base + plan records.
await exportMergePlanToPbf(plan).pipeTo(writable);

// O(base) extra memory; builds a standalone Osm with all indexes.
const { osm } = applyPlan(plan);
```

Expose it on the worker and remote next to the other plan methods, for example `OsmixWorker.exportMergePlanToPbf(baseOsmId, writeableStream)`. It must not end the plan session or replace the base.

### Merge app

Add an "Export merged PBF" action to the plan review, next to Apply and the osmChange export. It writes through the same file-handle path as `useOsmFile`'s export (`toPbfFile`), never through a whole-buffer path. After export the base and plan stay as they are, so the user can keep reviewing, apply, or load the exported file.

Follow `packages/ui/DESIGN.md` and `apps/app/DESIGN.md`. Read `docs/merge-process.md` first and update it for the new export path.

## Step 3: Deferred

Do not start these without a demonstrated need, for example users who must keep editing a country-scale merged result in the same session without reloading the export:

- read-only collection contracts in `@osmix/core` and overlay-aware tile encoders, inspection and routing after apply;
- worker overlay sessions with generations, restart restore, and compute-worker snapshots;
- replacing `applyMergePlan()`'s materialization with a persistent overlay.

Task 005 refers to "the read-only contracts introduced by Task 004". Those contracts are now part of this deferred work. If Task 005 goes ahead, it has to define them.

## Testing plan

- Differential tests on Monaco and on randomized small plans: stream the plan, reload with `fromPbf()`, and compare every entity by type and ID, and the semantic content hash, with `applyPlan()` exported through `toPbfStream()`.
- Ordering: records before, between and after base IDs; negative created IDs; an all-deleted entity type; an empty plan; a plan that only creates.
- Invalid sequences: create of an existing ID, modify or delete of a missing ID. Each error names the entity.
- A plan with integrity problems refuses to export with the same message as `applyPlan()`.
- Worker/remote: export leaves the plan session and the base dataset unchanged; export runs while compute workers keep serving tiles.
- Merge app: export writes through the file handle path, and review and apply still work afterward.

## Acceptance criteria

- Step 1 numbers are recorded in this file, with a stop / continue decision.
- If step 2 is done: the streamed PBF is semantically equal to `applyPlan()` output on all automated fixtures, and no `Osm` is built during the export.
- If step 2 is done: the target large-base scenario exports with peak additional memory bounded by the plan and export buffers, not the base size.
- `applyPlan()`, `applyChangesetToOsm()` and `merge()` behave as before.
- All affected workspaces and dependents pass format, lint, typecheck, tests and knip, per `AGENTS.md`.

## Likely files

- `packages/load/src/entity-stream.ts`, `packages/load/src/pbf.ts`
- `packages/change/src/plan/plan.ts`, `packages/change/src/plan/overlay.ts`, `packages/change/src/index.ts`
- `packages/osmix/src/worker.ts`, `packages/osmix/src/remote.ts`, `packages/osmix/src/index.ts`
- `apps/app/src/blocks/merge.tsx` and the plan review components
- `apps/bench` or a script for step 1
- `docs/merge-process.md`, package READMEs, a changeset
