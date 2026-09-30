# @osmix/change

`@osmix/change` plans and applies merges of OpenStreetMap datasets on top of [`@osmix/core`](../core/README.md): one plan per merge, reviewed by imported feature and applied in a single build.

The [merge-process guide](../../docs/merge-process.md) is the authoritative reference for merge rules, defaults, examples, workflows, and known limitations. This README describes the package API.

## Highlights

- **Plan once, apply once.** `planMerge` records every change a merge would make as proposals grouped by
  imported feature; `applyPlan` builds the result in a single pass and validates routing integrity.
- **Decide what needs you.** Identical-point merges, matching actions and crossings are proposals with a
  status, an effect and reasons. `setMergePlanDecisions` accepts or rejects them and replans only the phases
  they affect.
- **OSM ID convention.** Negative patch IDs are new features and move below the base's lowest ID, so
  independent imports never collide; positive IDs edit the base entity with that ID.
- **One call.** `merge(base, patch, options)` plans and applies with the Merge app's defaults.
- **Review output.** `generateMergePlanOsc` writes a plan as osmChange; `plan.diagnostics` reports routing
  topology and integrity problems before anything is built.

## Installation

```sh
pnpm add @osmix/change
```

Application code can import these APIs from the `osmix` facade. Install the granular package directly when building a lower-level package integration.

## Usage

### Merge in one call

```ts check-docs change-context
import { merge } from "osmix";

const combined = await merge(base, patch);
const matched = await merge(base, patch, {
  matching: { propertyKeys: ["name", "surface"], attachNetwork: true },
});
console.log(combined.id, matched.id);
```

By default identical points merge into the base, imported ways connect where they cross, and matching runs
only when configured. See [the plan's phases and defaults](../../docs/merge-process.md) for every rule.

### Plan, decide, apply

```ts check-docs change-context
import { applyPlan, generateMergePlanOsc, planMerge, setMergePlanDecisions } from "osmix";

const plan = planMerge(base, patch, {
  mergeIdenticalPoints: false,
  matching: { propertyKeys: ["name"], attachNetwork: true, automatic: "none" },
});

// Features whose proposals wait for a decision.
const waiting = plan.features.filter((feature) => feature.outcome === "needs-decision");
const decisions = waiting.flatMap((feature) =>
  feature.proposalIds
    .map((id) => plan.proposals.get(id))
    .filter((proposal) => proposal?.effect === "needs-decision")
    .map((proposal) => ({ proposalId: proposal!.id, action: "accept" as const })),
);
setMergePlanDecisions(plan, decisions);

const osc = generateMergePlanOsc(plan);
const { osm, summary } = applyPlan(plan);
console.log(osc.length, summary.features, osm.id);
```

A plan is live: keep it in the process that made it. Proposal IDs are built from original patch IDs and base
IDs (`exact:n-5>n123`, `connect:n-5>n123`, `copy:w-9>w44`, `remove:w-9>w44`,
`xnode:w-9|w44@7.4211234,43.7312345`), so decisions survive replans and restarts. Decisions naming proposals
the plan no longer has are listed in `plan.staleDecisions`.

### Plan options

- `patchIds` (`"osm"` or `"new"`, default `"osm"`): how patch IDs are read; `"new"` treats every patch
  entity as a new feature.
- `mergeIdenticalPoints` (default `true`): merge imported points at identical coordinates, and ways that
  then match, automatically. When false those merges wait for a decision.
- `createIntersections` (default `true`): connect imported ways to the ways they cross at the same grade.
- `matching` (optional): match imported features to nearby base features. `propertyKeys` and
  `attachNetwork` are required; `maxDistanceMeters` defaults to `1`, `automatic` to `"high-confidence"`,
  and `allowWayRemoval` to false (removal is always a manual choice).
- `automation` (`"conservative"`, `"recommended"` or `"aggressive"`, default `"recommended"`): how much the
  planner decides without a person. Its decisions are marked `automated` on the proposals and are replaced by
  any decision in `decisions`; see MP-M6 in the merge-process guide.
- `decisions`: `{ proposalId, action: "accept" | "reject" }[]`, a person's decisions.

### Discover matching candidates

`discoverConflationCandidates(base, patch, options)` returns the matching candidates between two untouched
datasets, with evidence, tag differences and reason codes, without planning a merge.

### Within one dataset

`planWithinDatasetDeduplication(osm)` returns the changes that remove duplicate nodes and ways inside one
dataset with the same rules; `applyChangesetToOsm` builds the cleaned dataset.

### Augmented diffs

Change records include an `oldEntity` for modifications and deletions, following the
[Overpass API Augmented Diffs](https://wiki.openstreetmap.org/wiki/Overpass_API/Augmented_Diffs) format.

### `generateOscChanges(changes, options?)`

Generates OSC (OSM Change) XML from change records, such as within-dataset deduplication's.

```ts check-docs change-context
import { generateOscChanges, planWithinDatasetDeduplication } from "osmix";

const changeset = planWithinDatasetDeduplication(base);

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
- [Osmix Merge app](../../apps/app/README.md) – Browser UI built on top of the change pipeline.

## Environment and limitations

- Requires runtimes compatible with `@osmix/core` (Node 24+, Bun, or modern browsers) since the same typed-array data structures are used.
- Deduplication helpers assume datasets store dense node blocks and rely on spatial indexes built via `Osm.buildIndexes()`.
- Intersection eligibility and its area-filtering limitation are specified in the [merge-process guide](../../docs/merge-process.md#intersections-and-validation).
- PBFs produced by older Osmix versions may already contain topology changes caused by automatic
  within-input deduplication. Those files cannot be repaired reliably without their source inputs and should
  be regenerated from the original base and patch files.

## Development

- `pnpm run test packages/change`
- `pnpm run lint packages/change`
- `pnpm run typecheck packages/change`

Run `pnpm run check` at the repo root before publishing to ensure formatting, lint, and type coverage.
