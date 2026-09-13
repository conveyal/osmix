# @osmix/change

`@osmix/change` is the change-management companion to [`@osmix/core`](../core/README.md). It builds, inspects, and applies OpenStreetMap changesets on top of `Osm` datasets, giving you tools to deduplicate entities, reconcile overlaps, generate stats, and orchestrate merge pipelines.

## Highlights

- Construct repeatable `OsmChangeset`s that track creates, modifies, and deletes with origin metadata and per-entity refs.
- **Augmented diffs**: Automatically captures both old and new entity states for modifications and deletions, following the [Overpass API Augmented Diffs](https://wiki.openstreetmap.org/wiki/Overpass_API/Augmented_Diffs) format.
- Conservatively reconcile compatible nodes or overlapping ways, replace references, and optionally create intersection points where geometry meets.
- Generate summary stats and OSC-friendly XML fragments so downstream systems can audit each change step.
- Run `merge(base, patch, options)` to execute the full dedupe/merge workflow with a single call.
- Export lightweight utilities for measuring distances, pruning duplicate refs, and deciding when ways should connect.

## Installation

```sh
pnpm add @osmix/change
```

Application code can import these APIs from the `osmix` facade. Install the granular package directly when building a lower-level package integration.

## Usage

### Build and apply a changeset

```ts check-docs pbf-pair
import { OsmChangeset, applyChangesetToOsm, changeStatsSummary, fromPbf } from "osmix";

const base = await fromPbf(monacoPbf);
const patch = await fromPbf(patchPbf);

const changeset = new OsmChangeset(base);
changeset.generateDirectChanges(patch);

console.log(changeStatsSummary(changeset.stats));

const merged = applyChangesetToOsm(changeset);
console.log(merged.id);
```

`OsmChangeset` keeps track of creates/modifies/deletes per entity type. Prefer `merge()` for the complete
pipeline. When composing it manually, generate direct changes and then reconcile patch nodes before patch
ways in one changeset rooted in the original base. Apply that changeset before creating intersections so the
new patch ways are present in the rebuilt spatial index. For that reason, `generateChangeset()` rejects
`directMerge: true` combined with `createIntersections: true`; use `merge()` for the staged pipeline.

### Generate an ordinary preview

```ts check-docs change-context
import { generateChangeset, type OsmChangesetOptions } from "osmix";

const options: Partial<OsmChangesetOptions> = {
  directMerge: true,
  deduplicateNodes: true,
  deduplicateWays: true,
};
const preview = generateChangeset(base, patch, options);
console.log(preview.stats);
```

`OsmChangesetOptions` supports `directMerge`, `deduplicateNodes`, `deduplicateWays`, and `createIntersections`. Ordinary `generateChangeset()` does not perform proximity matching. A defined `conflation` value is rejected before generation, including when supplied through JavaScript or a structurally wider typed object; `conflation: undefined` is treated as absent. The error directs callers to `generateConflationChangeset()` or `merge()` instead of returning a preview that silently omits requested matching.

Use `generateConflationChangeset(base, patch, { directMerge: true, conflation })` to inspect matching changes before applying them, or `merge(base, patch, { directMerge: true, conflation })` to run the high-level pipeline. These APIs continue to accept `Partial<OsmMergeOptions>`, which includes matching configuration. Cumulative matching previews keep intersection creation as a later stage; the high-level pipeline can run it after matching.

### Run the bundled merge pipeline

```ts check-docs change-context
import { merge } from "osmix";

const combined = await merge(base, patch, {
  directMerge: true,
  deduplicateNodes: true,
  deduplicateWays: true,
  createIntersections: true,
});
console.log(combined.id);
```

`merge` preserves the two source datasets and uses deduplication only to reconcile compatible patch entities
with the base. It optionally creates intersections and, when `directMerge` is true, generates modifications
that merge the patch into the base. All options default to `false`, so you can enable only the stages you need.
An empty patch is therefore an identity operation; the high-level pipeline does not normalize either input as
a hidden preliminary step.

Intersection creation distinguishes existing shared junctions from new crossings. Reusing an endpoint updates
every incident way and affected restriction via-node together, including an already connected bridge or tunnel
entrance. The proposed junction must preserve valid way geometry, restrictions, and grade context. If any part
of a shared-junction substitution is unsafe, that crossing is skipped and its original references remain.
Only an isolated endpoint with no affected restriction can use the dedicated crossing-node fallback when
replacement would degenerate its way. New grade-separated interior crossings remain disconnected.

Exact reconciliation and fuzzy way matching use the same [one-way normalization as routing](../router/README.md#way-direction).
Supported aliases such as `yes`/`true`/`1` and `no`/`false`/`0` compare by travel direction. An explicit
`no`, `false`, or `0` overrides a roundabout's implied forward direction. Exact reconciliation still requires
the same ordered node references and compatible remaining tags; fuzzy matching accounts for reversed
geometry when comparing direction. Unsupported nonempty values, including `reversible` and `alternating`,
prevent way matching even when their text is identical. Input tag values are retained rather than rewritten
to a canonical spelling.

Fuzzy matching cannot establish orientation when the endpoints fit equally well in both orders. It blocks
such candidates if either way is one-way or has recognized direction-sensitive routing tags, such as
`maxspeed:forward` or `oneway:bicycle`. This includes closed one-way roundabouts even when their tag values
and apparent winding agree. Bidirectional ways without those direction-sensitive tags can still match.
Exact reconciliation continues to compare ordered node references directly.

### Match imported data within one meter

Exact reconciliation remains the default. For imported GeoJSON, Shapefile, OSW, or other independently
created data, opt into proximity conflation with explicit property keys and an explicit network-attachment
choice. The historical radius is one meter unless `maxDistanceMeters` is supplied.

```ts check-docs change-context
import {
  applyChangesetToOsm,
  discoverConflationCandidates,
  generateConflationChangeset,
} from "osmix";

const conflation = {
  propertyKeys: ["name", "operator", "surface"],
  attachNetwork: true,
};
const discovery = discoverConflationCandidates(base, patch, conflation);

// Review discovery.candidates and persist decisions by stable candidate ID.
const decisions = discovery.candidates
  .filter((candidate) => candidate.status === "review")
  .map((candidate) => ({ candidateId: candidate.id, action: "reject" as const }));

const changeset = generateConflationChangeset(
  base,
  patch,
  {
    directMerge: true,
    deduplicateNodes: true,
    deduplicateWays: true,
    conflation,
  },
  decisions,
  discovery,
);
const conflated = applyChangesetToOsm(changeset);
```

Discovery compares only the untouched patch with the immutable original base. High-confidence actions are
scheduled by default; set `automatic: "none"` when every action should require a decision. Discovery does not
apply changes. OSM tags are feature attributes, such as `surface=asphalt` or `kerb=lowered`. **Copy tags**
(property transfer in the API) copies only selected tag values onto the base entity and retains the imported geometry. Compared with
the same direct/exact merge without property transfer, it never adds or removes entities or changes coordinates,
way references, or relation members. Missing patch values leave base tags unchanged. **Connect network**
(network attachment in the API) is a separate choice that changes only patch-created way references. Base IDs, coordinates, ordered way references,
and ordered relation members stay authoritative.

Structural properties cannot transfer. Routing-affecting properties, motor-road attachments, ambiguous
targets, ordinary relation membership, and uncertain geometry require review when otherwise eligible. Adding
a review reason never weakens an existing block: hard feature-type, grade, access, geometry, restriction, or reference
conflicts still prevent the affected action, even when an accept decision is supplied. Property transfer and
network attachment are assessed independently, so blocking one does not disable an otherwise eligible action.
Equivalent one-to-one patch ways remain after property transfer, including the nodes that connect them to other imported ways.
Exact reconciliation remains a separate operation; segmented way chains are reported but unsupported.

### Feature classification policy

Proximity proposes candidates; it does not establish feature identity. Discovery compares explicit classifications independently of the tag keys selected for copying. For example, `amenity=cafe` on the base and `amenity=school` on the import produce `feature-type-conflict` even when only `name` is selected. The conflict hard-blocks both enabled matching actions. Manual acceptance, bulk acceptance, and additional relation-membership review reasons cannot override it.

The supported classification keys are `amenity`, `shop`, `tourism`, `leisure`, `office`, `craft`, `healthcare`, `emergency`, `historic`, `man_made`, `natural`, `landuse`, `building`, `boundary`, `aeroway`, `railway`, `public_transport`, `power`, and `place`. Comparisons use trimmed, case-sensitive text for the same key. Different explicit values conflict, with these boundaries:

- Missing or empty values are unknown and do not establish a conflict.
- `yes` means an unspecified positive subtype, so it does not conflict with a more specific positive value. Explicit `no` conflicts with any different nonempty value, including `yes`.
- No cross-key, subtype-hierarchy, or semicolon-list equivalence is inferred. Names and other descriptive differences do not establish a classification conflict.

Candidate evidence includes optional `featureTypeConflicts: Array<{ key: string; baseValue: string | number; patchValue: string | number }>` containing the original typed values, independently of selected-tag `tagDiff` entries. Merge displays these base and imported values under **Feature type conflict**. Equal classifications or the absence of a supported conflict do not prove identity; existing geometry, routing, grade, and integrity checks still apply.

Blocking a matching candidate does not itself discard its imported feature. Ordinary direct/exact merge rules still apply, and same-ID authoritative updates retain their existing behavior. This classification policy applies to imported-data matching; it does not change the separate exact-reconciliation rules.

### Choosing matching actions

The current decision selects Copy tags, Connect network, both, or neither. An action can be eligible without
being selected. Changing one choice preserves the other on the same target, including a choice that was scheduled automatically.
Skipping a match schedules neither action; imported additions still follow the ordinary direct/exact merge
rules. Clearing a saved decision restores discovery defaults, which may schedule high-confidence actions
again. Automatic describes the current schedule, not a completed change.

Several candidates can propose different base targets for one imported feature. Matching actions may be
scheduled for only one of those targets: copying tags to one target while connecting to another is also a
conflict. Choosing a replacement must clear the prior target's actions while preserving other imported
features' decisions. In Merge, selecting an action on another alternative replaces the target using that
action choice, so a user can switch targets and copy tags without also connecting the network.
Leaving the feature unmatched schedules neither action for any target and retains
ordinary imported additions under the direct/exact merge rules.

## API

### `OsmChangeset`

Tracks and orchestrates changes against a base `Osm` dataset.

Schematic constructor signature:

```ts schematic
constructor(base: Osm)
```

#### Core methods

- `deduplicateNodes(nodes: Nodes)`: Check candidate nodes (normally from a patch) against the base dataset and map safe duplicates to the surviving base node. Proximity alone is not sufficient.
- `deduplicateWays(ways: Ways)`: Check candidate ways against the base and reconcile only matching geometry with compatible routing and grade-separation tags.
- `generateDirectChanges(patch: Osm)`: Merge a patch dataset into the changeset. Handles creates and updates.
- `createIntersectionsForWays(ways: Ways)`: Checks provided ways for intersections with existing ways in the base dataset. Splits ways and inserts nodes where they cross.
- `applyNodeReplacementsToWays(replacementMap)`: Updates way references based on a map of replaced node IDs (generated by `deduplicateNodes`).
- `applyNodeReplacementsToRelations(replacementMap)`: Updates relation members based on replaced node IDs.
- `toJSON(): OsmChanges`: Export changes, statistics, and versioned input identities for restoration. `JSON.stringify(changeset)` uses this method automatically.
- `OsmChangeset.fromJson(base, json, context?: OsmChangesetRestoreContext)`: Restore changes against the original base. When the snapshot records patches, provide their original datasets in `context.patches`, in generation order.

#### Save and restore changesets

```ts check-docs change-context
import { applyChangesetToOsm, OsmChangeset, type OsmChanges } from "osmix";

const changeset = new OsmChangeset(base);
changeset.generateDirectChanges(patch);

const serialized = JSON.stringify(changeset);
const saved: OsmChanges = JSON.parse(serialized);
const restored = OsmChangeset.fromJson(base, saved, { patches: [patch] });
const result = applyChangesetToOsm(restored);
console.log(result.id);
```

Keep the original, immutable `Osm` input snapshots with built indexes available when restoring. The optional
`OsmChanges.validationContext` records a format version, the base identity, and the identities of patches
passed to `generateDirectChanges()`. Each identity includes the dataset ID, content hash, and content-hash
version. Restoration checks these identities and recomputes inherited integrity issues from the supplied
datasets. The snapshot does not contain a trusted list of issue exemptions.

The existing content hash identifies indexed storage, including string-table and entity order. Inputs with
equivalent map features but different storage can have different hashes. Keep identical input snapshots and
IDs, or regenerate the changeset from the available inputs. These noncryptographic checks detect inconsistent
input context; they do not authenticate a saved file. Unsupported context versions, missing patch inputs,
and mismatched identities fail explicitly.

Restoration preserves the ordinary integrity policy: existing base issues and eligible inherited patch grade
issues remain distinguishable from newly introduced problems. It does not exempt new dangling references,
collapsed highways, broken restrictions, or new connections between grade-separated ways. Supplying patch
context cannot make those failures valid.

Legacy `OsmChanges` objects without `validationContext` remain usable when base-only validation succeeds.
If application requires unavailable patch context, it fails with guidance to restore a context-bearing snapshot
with its original inputs or regenerate the changeset. Passing patches with legacy JSON cannot grant new
exemptions. If you extend a restored legacy changeset with `generateDirectChanges(patch)`, subsequent exports
record the base and the patches supplied during that extension. Validation uses those known inputs; it never
infers original patch context from older change records.

The Merge app's **Download JSON changes** action exports a diagnostic array of changes, not this restorable
`OsmChanges` snapshot.

### `merge(base: Osm, patch: Osm, options)`

High-level pipeline to merge `patch` into `base`. Returns a new `Osm` instance.

Options:

- `directMerge` (boolean): Apply creates/updates from patch.
- `deduplicateNodes` (boolean): Reconcile compatible patch nodes with unique base matches.
- `deduplicateWays` (boolean): Reconcile compatible patch ways with matching base geometry.
- `createIntersections` (boolean): Split intersecting ways.
- `conflation` (optional): Explicit imported-data matching configuration. `propertyKeys` and
  `attachNetwork` are required when supplied; `maxDistanceMeters` defaults to `1`, and `automatic` defaults
  to `"high-confidence"`.

### Conflation discovery and generation

- `discoverConflationCandidates(base, patch, options)`: Return deterministic node and one-to-one-way
  candidates with action-specific status, evidence, tag diffs, and reason codes.
- `resolveConflationActions(candidate, decision?)`: Return the eligible actions currently scheduled as
  `{ transferProperties, attachNetwork }`. Use this result for selected control states and action labels.
- `buildConflationActionDecision(candidate, current, action, selected)`: Change `"transfer-properties"` or
  `"attach-network"` while preserving the other resolved choice. Returns an accept decision with both flags
  explicit; eligibility checks still govern whether either action can be scheduled.
- `buildConflationSourceDecision(candidates, decisions, source, selected)`: Replace the choices for one
  `{ entityType, sourceId }`. Pass a candidate decision as `selected` to retain its action flags and reject
  every sibling target, or `null` to leave the imported feature unmatched. Returns the complete decision
  snapshot with unrelated sources preserved.
- `filterConflationCandidates(candidates, filter, decisions?)`: Filter discovery rows without rerunning the
  spatial search.
- `summarizeConflationCandidates(candidates, decisions?)`: Count accepted, automatic, review, blocked, unmatched, and
  rejected rows.
- `generateConflationChangeset(base, patch, mergeOptions, decisions?, discovery?)`: Generate one cumulative
  direct, exact, and fuzzy changeset from untouched inputs.
- `generateConflationArtifacts(base, patch, mergeOptions, decisions?, discovery?)`: Generate the same
  cumulative changeset plus its `ordinaryBaseline`, materialized `result`, and matching `outcome` report.
- `generateConflationApplicationChangeset(baseline, patch, discovery, originalBase, decisions?)`: Apply only
  reviewed fuzzy actions to an already materialized ordinary-merge baseline. The immutable original base is
  required so generation can rediscover and validate candidates instead of trusting mutable review records.

An `OsmConflationDecision` uses `transferProperties` for Copy tags and `attachNetwork` for Connect network.
With no decision, only actions classified `automatic` are scheduled. An accept decision honors explicit
flags; omitted flags retain the legacy behavior of selecting every eligible action. New controls should use
`buildConflationActionDecision()` so changing one choice does not accidentally select the other. Reject
decisions schedule neither action. An accept decision with both flags `false` also resolves to the effective
`rejected` status, shown as **Skipped** in Merge. Blocked and unmatched actions remain unscheduled regardless
of requested flags.

Use `buildConflationSourceDecision()` when changing targets. It validates the replacement and explicitly
rejects sibling targets so automatic defaults cannot select them again. Older reviews can be corrected one
imported feature at a time: existing conflicts for other sources remain unchanged, but the replacement cannot
introduce a new source conflict or bypass checks for competing uses of a base target. Generation, raw
single-decision or full-set updates, and bulk actions still require a fully valid decision set. Supply the
full discovery candidate collection and complete decision snapshot; a single page cannot validate decisions
for other sources. Multiple-target validation
errors identify the imported feature and expose `error.conflict` as an `OsmConflationDecisionConflict` with
`entityType`, `sourceId`, `candidateIds`, and `message`. Hard blockers still prevent the affected action. Bulk actions conservatively
skip ambiguous and many-to-one candidates, including an already selected alternative; use individual
target and action controls to resolve those features.

### Matching outcome reports

`generateConflationArtifacts()` returns an `OsmConflationOutcomeReport` alongside the generated dataset. The report compares the ordinary direct/exact baseline with the generated result, so its action counts describe actual changes rather than candidate eligibility or scheduled choices. Generation alone does not replace a loaded base dataset; a workflow should show these counts as completed work only after successful application and any required intersection stage.

The report's `stage` is `"matching-before-intersections"`. All outcome fields describe the result immediately after matching, before intersection creation. A later intersection stage can add connections or remap a shared junction to another node. Reported targets, connected way IDs, unresolved work, and retention remain evidence of the matching stage; they are not a snapshot of the later dataset's references. Intersection effects must not be credited as matching actions.

A tag-copy action counts one source-target mapping credited with at least one surviving changed tag value in the matching result. A network-connection action counts one matched imported node whose references changed in at least one imported way, rather than counting every affected way. Feature totals count unique imported nodes and ways considered for matching, with alternative targets counted once. They do not count every entity in the import: ordinary same-ID updates and features outside the matching options are excluded.

Unresolved features need attention; intentionally skipped features are counted separately. Applied and unresolved counts can overlap when only part of a feature's requested work succeeded. Selected values already present on a base target are not failed copies. A key also counts as already equal when every alternative target already has that value in the ordinary baseline and matching result; this does not select a target. A value supplied by another surviving copy is satisfied without receiving another action credit. Only values missing from the target after matching because of a competing copy are reported as `superseded`.

The report includes per-feature and per-tag details so clients can identify which selected attributes were not copied to a base target and why:

| Field             | Meaning                                                                                                                                                                                                              |
| ----------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `summary`         | Unique considered, applied, unresolved, skipped, and unchanged feature counts; separate tag-copy, copied-value, and network-connection counts. Partial success can contribute to both applied and unresolved totals. |
| `features`        | One row per considered imported node or way, with original ID, candidate IDs, base target used for comparison when known, copied keys, connected way IDs, and unresolved or skipped status.                          |
| `tags`            | Per-key `presentFeatures`, `copiedFeatures`, `alreadyEqualFeatures`, and `satisfiedByOtherCopyFeatures`, plus `uncopied` source IDs and reasons. Absent imported values are excluded.                                |
| `retainedImports` | Node, way, and relation counts for original imported IDs present in the result, plus the subset retained as ordinary additions.                                                                                      |

Uncopied tag reasons distinguish `no-accepted-target`, `blocked`, `not-selected`, `protected-tag`, and `superseded`; discovery reasons provide further context. When copies compete for a target tag, only the surviving write receives credit. These reasons report the existing matching rules; they do not expose a configurable conflict policy.

A skipped or unresolved match does not discard the imported feature; ordinary imported additions, including their original attributes, remain subject to the direct/exact merge rules. Retained-import counts refer to original imported IDs still present after matching. Exact reconciliation can instead represent an imported feature under a base ID, so absence from those counts does not by itself mean the feature was lost. A subsequent intersection can allocate an ID that exact reconciliation removed; that newly created node is not evidence that the original imported feature was retained.

### `applyChangesetToOsm(changeset: OsmChangeset): Osm`

Applies all pending changes in the changeset to produce a **new** `Osm` instance. The original `base` is immutable.
Application rejects new dangling references, degenerate highways, and detached turn-restriction topology
before returning the result. A detached via-node error identifies the restriction, via node, and participating
from/to way IDs so the source junction can be inspected and corrected.

### Augmented Diffs

By default, all `OsmChange` records include an `oldEntity` field for modifications and deletions, capturing the entity's state before the change. This follows the [Overpass API Augmented Diffs](https://wiki.openstreetmap.org/wiki/Overpass_API/Augmented_Diffs) format.

```ts check-docs change-context
import { OsmChangeset } from "osmix";

const changeset = new OsmChangeset(base);
changeset.generateDirectChanges(patch);

// Access the old and new state for a modified entity
const wayChange = changeset.wayChanges[wayId];
if (wayChange) {
  console.log("Old tags:", wayChange.oldEntity?.tags);
  console.log("New tags:", wayChange.entity.tags);
}
```

### `generateOscChanges(changeset, options?)`

Generates OSC (OSM Change) XML format from a changeset.

```ts check-docs change-context
import { generateOscChanges, OsmChangeset } from "osmix";

const changeset = new OsmChangeset(base);

// Generate standard OSC for API uploads (default)
const osc = generateOscChanges(changeset);

// Generate augmented diff with old/new sections
const augmentedOsc = generateOscChanges(changeset, { augmented: true });
console.log(osc.length, augmentedOsc.length);
```

Options:

- `augmented` (boolean, default: `false`): When true, modifications include `<old>` and `<new>` sections, and deletions include `<old>` sections with the full entity data.

## Related Packages

- [`@osmix/core`](../core/README.md) – Typed-array index powering the change operations.
- [`@osmix/pbf`](../pbf/README.md) – Streaming helpers used to read and write `.osm.pbf` data.
- [`@osmix/json`](../json/README.md) – JSON entity adapters that pair with change workflows.
- [Osmix Merge app](../../apps/merge/README.md) – Browser UI built on top of the change pipeline.

## Environment and limitations

- Requires runtimes compatible with `@osmix/core` (Node 20+, Bun, or modern browsers) since the same typed-array data structures are used.
- Deduplication helpers assume datasets store dense node blocks and rely on spatial indexes built via `Osm.buildIndexes()`.
- Intersections are generated only for highway/footway-style features; polygonal ways are ignored.
- A scan that compares a dataset with itself is useful for diagnostics, but its proposed proximity matches
  should not be applied automatically. Use the high-level cross-dataset merge for reconciliation.
- PBFs produced by older Osmix versions may already contain topology changes caused by automatic
  within-input deduplication. Those files cannot be repaired reliably without their source inputs and should
  be regenerated from the original base and patch files.

## Development

- `pnpm run test packages/change`
- `pnpm run lint packages/change`
- `pnpm run typecheck packages/change`

Run `pnpm run check` at the repo root before publishing to ensure formatting, lint, and type coverage.
