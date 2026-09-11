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
a review reason never weakens an existing block: hard grade, access, geometry, restriction, or reference
conflicts still prevent the affected action, even when an accept decision is supplied. Property transfer and
network attachment are assessed independently, so blocking one does not disable an otherwise eligible action.
Equivalent one-to-one patch ways remain after property transfer, including the nodes that connect them to other imported ways.
Exact reconciliation remains a separate operation; segmented way chains are reported but unsupported.

The current decision selects Copy tags, Connect network, both, or neither. An action can be eligible without
being selected. Changing one choice preserves the other, including a choice that was scheduled automatically.
Skipping a match schedules neither action; imported additions still follow the ordinary direct/exact merge
rules. Clearing a saved decision restores discovery defaults, which may schedule high-confidence actions
again. Automatic describes the current schedule, not a completed change.

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
- `filterConflationCandidates(candidates, filter, decisions?)`: Filter discovery rows without rerunning the
  spatial search.
- `summarizeConflationCandidates(candidates, decisions?)`: Count accepted, automatic, review, blocked, unmatched, and
  rejected rows.
- `generateConflationChangeset(base, patch, mergeOptions, decisions?, discovery?)`: Generate one cumulative
  direct, exact, and fuzzy changeset from untouched inputs.
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
