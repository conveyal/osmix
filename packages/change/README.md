# @osmix/change

`@osmix/change` is the change-management companion to [`@osmix/core`](../core/README.md). It builds, inspects, and applies OpenStreetMap changesets on top of `Osmix` datasets, giving you tools to deduplicate entities, reconcile overlaps, generate stats, and orchestrate merge pipelines.

## Highlights

- Construct repeatable `OsmixChangeset`s that track creates, modifies, and deletes with origin metadata and per-entity refs.
- Deduplicate coincident nodes or overlapping ways, replace references, and optionally create intersection points where geometry meets.
- Generate summary stats and OSC-friendly XML fragments so downstream systems can audit each change step.
- Run `merge(base, patch, options)` to execute the full dedupe/merge workflow with a single call.
- Export lightweight utilities for measuring distances, pruning duplicate refs, and deciding when ways should connect.

## Installation

```sh
bun install @osmix/change
```

You will typically install this alongside [`@osmix/core`](../core/README.md), which supplies the `Osmix` datasets the changes operate on.

## Usage

### Build and apply a changeset

```ts
import { Osmix } from "osmix"
import { OsmixChangeset, changeStatsSummary } from "@osmix/change"

const base = await Osmix.fromPbf(Bun.file('./monaco.pbf').stream())
const patch = await Osmix.fromPbf(Bun.file('./monaco-changes.pbf').stream())

const changeset = new OsmixChangeset(base)
changeset.deduplicateNodes(base.nodes)
changeset.deduplicateWays(base.ways)
changeset.generateDirectChanges(patch)

console.log(changeStatsSummary(changeset.stats))

const merged = changeset.applyChanges()
```

`OsmixChangeset` keeps track of creates/modifies/deletes per entity type. Call the helpers (`deduplicateNodes`, `deduplicateWays`, `generateDirectChanges`, `createIntersectionsForWays`, etc.) in whatever order your workflow requires, then `applyChanges()` to produce a new `Osmix` instance with the edits applied.

### Run the bundled merge pipeline

```ts
import { merge } from "@osmix/change"

const combined = await merge(base, patch, {
	directMerge: true,
	deduplicateNodes: true,
	deduplicateWays: true,
	createIntersections: true,
})
```

`merge` wraps a sequence of changesets that deduplicate each dataset, optionally create intersections, and (when `directMerge` is true) generate modifications that reconcile the patch into the base. All options default to `false`, so you can enable only the stages you need.

## API

WIP

## See also

- [`@osmix/core`](../core/README.md) – Typed-array index powering the change operations.
- [`@osmix/pbf`](../pbf/README.md) – Streaming helpers used to read and write `.osm.pbf` data.
- [`@osmix/json`](../json/README.md) – JSON entity adapters that pair with change workflows.
- [Osmix Merge app](../../apps/merge/README.md) – Browser UI built on top of the change pipeline.

## Environment and limitations

- Requires runtimes compatible with `@osmix/core` (Node 20+, Bun, or modern browsers) since the same typed-array data structures are used.
- Deduplication helpers assume datasets store dense node blocks and rely on spatial indexes built via `Osmix.buildIndexes()`.
- Intersections are generated only for highway/footway-style features; polygonal ways are ignored.

## Development

- `bun run test packages/change`
- `bun run lint packages/change`
- `bun run typecheck packages/change`

Run `bun run check` at the repo root before publishing to ensure formatting, lint, and type coverage.
