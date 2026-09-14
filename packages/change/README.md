# @osmix/change

`@osmix/change` is the change-management companion to [`@osmix/core`](../core/README.md). It builds, inspects, and applies OpenStreetMap changesets on top of `Osm` datasets, giving you tools to deduplicate entities, reconcile overlaps, generate stats, and orchestrate merge pipelines.

The [merge-process guide](../../docs/merge-process.md) is the authoritative reference for merge rules, defaults, examples, workflows, and known limitations. This README describes the package API.

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

See the [worked merge](../../docs/merge-process.md#worked-merge) and [direct/exact rules](../../docs/merge-process.md#direct-and-exact-rules) for the effect of these options. All stages default off in the API.

### Match imported data within one meter

Configure imported-data matching explicitly. Review the [identity prerequisites](../../docs/merge-process.md#inputs-and-identity) before merging independently converted GIS data.

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

For the behavioral contract, see [matching measurements and policies](../../docs/merge-process.md#matching-rules), [action selection](../../docs/merge-process.md#mp-m5), and [explicit imported-way removal](../../docs/merge-process.md#mp-r1). Copying, connecting, and removal are separate actions. Use `buildConflationActionDecision()` to update one choice while preserving the others.

## API

### `OsmChangeset`

Tracks and orchestrates changes against a base `Osm` dataset.

Schematic constructor signature:

```ts schematic
constructor(base: Osm)
```

#### Core methods

- `deduplicateNodes(nodes: Nodes)`: Check exact-coordinate candidates (normally from a patch) against the base dataset, validate all sources proposed for each final survivor together, and return safe replacement mappings. A conflicting node group retains all of its proposed sources.
- `deduplicateWays(ways: Ways)`: Check candidate ways against the base and reconcile only matching geometry with compatible routing and grade-separation tags.
- `generateDirectChanges(patch: Osm)`: Merge a patch dataset into the changeset. Handles creates and updates.
- `createIntersectionsForWays(ways: Ways)`: Checks provided ways for intersections with existing ways in the base dataset. Inserts shared node references into existing ways.
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

High-level pipeline to merge `patch` into `base`. Returns the resulting `Osm`; with no stages enabled, returns the original base. See the [defaults and stage order](../../docs/merge-process.md#defaults-and-stage-order).

Options:

- `directMerge` (boolean): Apply creates/updates from patch.
- `deduplicateNodes` (boolean): Reconcile compatible patch nodes with unique base matches.
- `deduplicateWays` (boolean): Reconcile compatible patch ways with matching base geometry.
- `createIntersections` (boolean): Insert shared references at eligible crossings.
- `conflation` (optional): Explicit imported-data matching configuration. `propertyKeys` and
  `attachNetwork` are required when supplied; `maxDistanceMeters` defaults to `1`, and `automatic` defaults
  to `"high-confidence"`. `allowWayRemoval` defaults to false and enables manual review only.

### Conflation discovery and generation

- `discoverConflationCandidates(base, patch, options)`: Return deterministic node and one-to-one-way
  candidates with action-specific status, evidence, tag diffs, and reason codes.
- `resolveConflationActions(candidate, decision?)`: Return the eligible actions currently scheduled as
  `{ transferProperties, attachNetwork, removeWay? }`. `removeWay` appears only for an eligible explicitly selected removal. Use this result for selected control states and action labels.
- `buildConflationActionDecision(candidate, current, action, selected)`: Change `"transfer-properties"`,
  `"attach-network"`, or `"remove-way"` while preserving the other resolved choices. Returns an accept decision that preserves automatic connection scheduling without converting it into explicit connection approval. Removal remains explicit and eligibility still governs each action.
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

Use `buildConflationSourceDecision()` when changing targets. Supply the full discovery and decision snapshot rather than a single visible page. Source-conflict errors expose `error.conflict` as an `OsmConflationDecisionConflict` with `entityType`, `sourceId`, `candidateIds`, and `message`. See [decision rules](../../docs/merge-process.md#mp-m5) for selection, bulk-operation, and conflict behavior.

### Matching outcome reports

`generateConflationArtifacts()` returns an `OsmConflationOutcomeReport` alongside the generated dataset. Its `stage` is `"matching-before-intersections"`. See [Reading the result](../../docs/merge-process.md#reading-the-result) for counting rules, partial outcomes, and stage boundaries.

| Field             | Meaning                                                                                                                                                                                                                                            |
| ----------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `summary`         | Unique considered, applied, unresolved, skipped, and unchanged feature counts; separate tag-copy, copied-value, network-connection, and optional way-removal/cleanup counts. Partial success can contribute to both applied and unresolved totals. |
| `features`        | One row per considered imported node or way, with original ID, candidate IDs, base target used for comparison when known, copied keys, connected way IDs, optional removal details, and unresolved or skipped status.                              |
| `tags`            | Per-key `presentFeatures`, `copiedFeatures`, `alreadyEqualFeatures`, and `satisfiedByOtherCopyFeatures`, plus `uncopied` source IDs and reasons. Absent imported values are excluded.                                                              |
| `retainedImports` | Node, way, and relation counts for original imported IDs present in the result, plus the subset retained as ordinary additions.                                                                                                                    |

Uncopied tag reasons distinguish `no-accepted-target`, `blocked`, `not-selected`, `protected-tag`, and `superseded`; discovery reasons provide further context. When copies compete for a target tag, only the surviving write receives credit. These reasons report the existing matching rules; they do not expose a configurable conflict policy.

A skipped or unresolved match does not itself discard the imported feature; explicit removals are recorded separately in `features[].wayRemoval`. Other imported additions remain subject to the direct/exact merge rules. Retained-import counts refer to original imported IDs still present after matching. Exact reconciliation can instead represent an imported feature under a base ID, so absence from those counts does not by itself mean the feature was lost. A subsequent intersection can allocate an ID that exact reconciliation removed; that newly created node is not evidence that the original imported feature was retained.

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
- Intersection eligibility and its area-filtering limitation are specified in the [merge-process guide](../../docs/merge-process.md#intersections-and-validation).
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
