# osmix

`osmix` is the high-level entrypoint for the Osmix toolkit. It layers ingestion,
streaming, and worker orchestration utilities on top of the low-level
`@osmix/core` index so you can load `.osm.pbf` files, convert GeoJSON, and
request raster/vector tiles with a single import. PBF loading, extraction, and
export live in [`@osmix/load`](../load/README.md) and are re-exported here.

## Installation

```sh
pnpm add osmix
```

## Usage

### Load a PBF and inspect it

```ts check-docs
import { fromPbf, fromGeoJSON, toPbfBuffer } from "osmix";

const monacoResponse = await fetch("./monaco.pbf");
const monacoPbf = new Uint8Array(await monacoResponse.arrayBuffer());
const osm = await fromPbf(monacoPbf);

console.log(osm.nodes.size, osm.ways.size, osm.relations.size);

const geojsonFile = await fetch("/fixtures/buildings.geojson").then((r) => r.arrayBuffer());
const geoOsm = await fromGeoJSON(geojsonFile);
const pbfBytes = await toPbfBuffer(geoOsm);
console.log(pbfBytes.byteLength);
```

### Work off the main thread with `OsmixRemote`

```ts check-docs worker-pbf-inputs
import { createRemote } from "osmix";

using remote = await createRemote();
const monaco = await remote.fromPbf(monacoPbf);
const patch = await remote.fromPbf(patchPbf, { id: "patch" });
const merged = await monaco.merge(patch);
const rasterTile = await merged.getRasterTile([10561, 22891, 16]);
console.log(rasterTile.byteLength);
```

High-level merges leave the original inputs intact and reconcile only compatible patch entities with unique
base matches. Regenerate PBFs created by older releases from their original inputs if automatic within-file
deduplication may already have rewritten routing topology.

Intersection creation preserves existing shared junctions, including bridge and tunnel entrances. Endpoint
reuse updates every incident way and affected restriction via-node together; an unsafe shared-junction
substitution leaves that crossing unchanged. This does not connect new grade-separated interior crossings.
The same rules apply through direct merge APIs and worker-backed operations.

### Profile merge performance

The test-only merge profiler runs the reviewed merge stages in their production order and reports per-stage
wall time, CPU time, RSS, heap use, operation counts, and output fingerprints as JSON. The PBF fingerprint
normalizes the export header's current timestamp; all entity bytes still use the production serializer. Monaco
is checked into the repository and is the safe default:

```sh
pnpm --filter osmix profile:merge -- --scenario monaco --runs 5 --output /tmp/monaco-merge.json
```

Two larger profiles use ignored local fixtures. They never download data and fail with the required path when
a fixture is absent:

```sh
# Recommended Yakima property keys, 1-meter matching, network attachment, and all merge stages.
pnpm --filter osmix profile:merge -- --scenario yakima --runs 3 --output /tmp/yakima-merge.json

# Direct merge, exact reconciliation, and intersections for the reported full-merge regression.
pnpm --filter osmix profile:merge -- --scenario eastern-washington --runs 1 \
  --output /tmp/eastern-washington-merge.json
```

The Yakima scenario uses `OsmixWorker.generateConflationChangeset`. Its generation stage includes CAR/WALK
routing diagnostics and the automatic network-attachment CAR safety projection.

Yakima requires `fixtures/yakima-full.osm.pbf` and `fixtures/yakima.osw.pbf`. Eastern Washington requires
`fixtures/osmix-e_wa_osm.pbf` and `fixtures/east_washington_sidewalk_proviso_1.pbf`. The existing Eastern
Washington correctness test remains opt-in with `OSMIX_EASTERN_WASHINGTON_INTEGRATION=1`.

`OSMIX_MERGE_PROFILE_SCENARIO`, `OSMIX_MERGE_PROFILE_RUNS`, and `OSMIX_MERGE_PROFILE_OUTPUT` are equivalent
to the command-line flags. Compare reports produced with the same commit, Node version, hardware, and idle
system. `processPeakRssBytes` is the process-lifetime high-water mark, so later repetitions can retain an
earlier run's peak. CI verifies operation counts and semantic fingerprints, but intentionally has no timing
threshold or compressed-PBF byte golden.

Proximity matching for independently created imports is available as a separate opt-in review session. The
recommended defaults use a 1-meter radius and schedule high-confidence actions automatically. Discovery and
decision changes do not update the base dataset:

```ts check-docs worker-pbf-inputs
import { createRemote } from "osmix";

using remote = await createRemote();
const base = await remote.fromPbf(monacoPbf);
const patch = await remote.fromPbf(patchPbf, { id: "imported-data" });

const summary = await remote.discoverConflation(base.id, patch.id, {
  propertyKeys: ["name", "operator", "surface"],
  attachNetwork: true,
});
const page = await remote.getConflationPage(base.id, 0, 25, { groupBySource: true });

// Page previews cover every candidate matching the worker's current filter, not
// just the rows returned on this page.
console.log(page.bulkActions["transfer-properties"]);
await remote.applyConflationBulkDecision(base.id, {
  action: "transfer-properties",
  filter: { status: "review" },
});

const generated = await remote.generateConflationChangeset(base.id, {
  directMerge: true,
  deduplicateNodes: true,
  deduplicateWays: true,
});
console.log(summary, generated.routing.car, generated.routing.walk);
await remote.applyChangesAndReplace(base.id);
```

OSM tags are feature attributes, such as `surface=asphalt` or `kerb=lowered`. **Copy tags** (property transfer
in the API) changes only explicitly selected tags and retains imported geometry, including matched ways
and their connecting nodes. Relative to the same direct/exact merge without property transfer, it never adds or
removes entities or changes coordinates, way references, or relation members. This applies to automatic,
individual, and filter-wide decisions. **Connect network** (network attachment in the API) separately rewrites only patch-created way
references. The worker preserves discovery settings, filters, decisions, and generated changes across worker
restarts, and reports CAR/WALK node, edge, and component deltas before the changeset is applied. Automatic
pedestrian attachments are rejected if they alter routable CAR topology.

Copy tags and Connect network are independent choices. Review controls show which actions are currently
scheduled, separately from whether discovery considers each action eligible. Changing one choice preserves
the other. The shared `resolveConflationActions(candidate, decision?)` helper returns the scheduled
`transferProperties` and `attachNetwork` flags. Use `buildConflationActionDecision()` to build a row update:

```ts check-docs
import {
  buildConflationActionDecision,
  type OsmConflationCandidate,
  type OsmConflationDecision,
} from "osmix";

function chooseCopyTags(
  candidate: OsmConflationCandidate,
  current: OsmConflationDecision | undefined,
  selected: boolean,
) {
  return buildConflationActionDecision(candidate, current, "transfer-properties", selected);
}
```

Persist the returned decision with `setConflationDecision()`. The `"attach-network"` action works the same
way for Connect network. The helper writes both flags explicitly. For backward compatibility, omitted flags
on a manually constructed accept decision select every eligible action.

Skipping a match, including turning both choices off, schedules neither action and retains ordinary
imported additions under the direct/exact merge rules. Removing a saved decision with
`setConflationDecisions()` restores that candidate's discovery defaults; the Merge app calls this
**Use automatic choices**.

`generateConflationChangeset()` stages the selected actions in a preview. **Automatic** means scheduled by
the matching rules, not already applied. Inspect the preview before calling `applyChangesAndReplace()` to
update the base dataset. Saved choices survive navigation and worker recovery, and regenerated previews use
the current choices. Updating or clearing decisions invalidates their dependent matching preview.

Filter-wide decisions are computed and committed atomically in the worker. Property and network actions
accept eligible automatic and review candidates while skipping blocked, unmatched, ambiguous, or structurally
invalid matches. Each action preserves the other current choice, using the same decision resolution as an
individual control. Reject schedules neither action for every filtered candidate that is not already rejected;
the Merge app labels this **Skip filtered**. Each result returns the
complete decision snapshot for restart recovery, and accepted candidates can be queried with
`{ status: "accepted" }`.

Review and acceptance cannot override an action's hard safety block. Ordinary relation membership or
ambiguity adds review context without making an already blocked action eligible. Property transfer and network
attachment retain separate eligibility, including after worker recovery; an eligible action can proceed while
the other remains blocked. Filter-wide decisions skip the blocked action and count it as ineligible.

#### Review alternative targets and correct choices

Merge groups possible targets under their imported feature. Only one target can have scheduled matching
actions, including when Copy tags and Connect network are selected independently. Choosing a target selects
its eligible configured actions; adjust the two checkboxes afterward if needed. An eligible checkbox on an
unselected alternative also switches to that target, using the selected action without requiring both.
Turning both off leaves no selected target. **Leave unmatched** clears every alternative's matching actions while retaining ordinary
imported additions under the direct/exact merge rules.

Use `setConflationSourceDecision(baseId, source, selected)` for paged review controls. `source` identifies
one `{ entityType, sourceId }`; `selected` is the chosen candidate decision, or `null` to leave the imported
feature unmatched. The worker uses its complete discovery to reject sibling targets and preserve decisions
for other imported features. It returns `{ summary, decisions }`; replace the client decision snapshot with
the returned complete array so sibling and off-page choices stay synchronized. The standalone
`buildConflationSourceDecision(candidates, decisions, source, selected)` helper provides the same replacement
for clients holding the full discovery candidate collection and complete decision snapshot. Do not pass only
a page of candidates to that helper. Single-decision and batch worker updates reject conflicting effective targets before changing
saved decisions or invalidating a generated preview. The error identifies the imported feature and candidate
IDs; its `conflict` object provides `entityType`, `sourceId`, `candidateIds`, and `message` for focusing review
on that feature. Bulk selection skips ambiguous alternatives; resolve them individually.

Use `getConflationPage(baseId, page, pageSize, { groupBySource: true })` to keep all alternatives together.
In this mode, `pageSize` and `totalPages` count imported features, `totalSources` reports the number of
matching source groups, and `groups` lists each group's entity type, source ID, and candidate IDs.
`candidates` includes every alternative for those paged groups. An alternative outside the current filters
has `matchesFilter: false`; label it as context. `totalCandidates` still counts only candidates that match
the filters, and bulk previews and actions remain restricted to those matching candidates. Omitting the
fourth argument retains ordinary flat candidate paging.

If an older session already contains conflicting choices, its candidates remain readable and the page
includes `validationConflict` with an affected imported feature and candidate IDs. Explicit source updates
can correct one feature at a time while preserving other sources' existing conflicts. They cannot introduce
new conflicts or bypass checks for competing uses of a base target. Bulk previews report no eligible changes,
and generation remains blocked, until every conflict is corrected through explicit target choices or
**Leave unmatched**. Raw single-decision and full-set updates remain strict.

Before applying a cumulative matching preview, **Back to matching** returns from reconciliation, the preview,
or a generation failure with the original loaded inputs, options, and decisions preserved. Correct the
identified imported feature and regenerate the preview without reloading either file. Retrying an unchanged
invalid decision set continues to report its conflict. Once the cumulative changes have been applied,
intersection failures use the intersection retry path; returning to matching is not an undo operation.

#### Which mode am I in?

`createRemote()` picks the best mode the current runtime supports and reports
it via `remote.mode`. Use `getOsmixCapabilities()` to inspect the runtime
before creating a remote:

```ts check-docs
import { createRemote, getOsmixCapabilities } from "osmix";

console.log(getOsmixCapabilities());
// { workerRuntime: "web", canShareArrayBuffers: false, maxWorkers: 1, recommendedMode: "single-worker", ... }

using remote = await createRemote();
console.log(remote.mode, remote.workerCount); // "single-worker", 1
```

#### Environment support

| Environment                                  | Mode            | Behavior                                                          |
| -------------------------------------------- | --------------- | ----------------------------------------------------------------- |
| Browser, [cross-origin isolated][coi]        | `multi-worker`  | One worker per core; datasets shared via `SharedArrayBuffer`      |
| Browser, not isolated (no COOP/COEP headers) | `single-worker` | One worker; data is transferred/copied instead of shared          |
| Bun                                          | Web Workers     | Runs off-thread; shared buffers enable multi-worker datasets      |
| Deno                                         | Web Workers     | Runs off-thread; local worker entries require read permission     |
| Node 20+                                     | worker threads  | Runs off-thread; shared buffers enable multi-worker datasets      |
| No worker implementation                     | throws          | Pass `inProcess: true` or use the main-thread API                 |
| `createRemote({ inProcess: true })`          | `in-process`    | Same API on the calling thread; long operations block that thread |

[coi]: https://developer.mozilla.org/en-US/docs/Web/API/Window/crossOriginIsolated

Single-worker mode is fully supported — everything works, just without
parallelism. Multi-worker mode is a performance upgrade that requires
cross-origin isolation (below). Explicitly requesting `workerCount > 1`
without it throws.

#### Enabling multi-worker mode

Browsers only allow sharing `SharedArrayBuffer`s between workers in
cross-origin isolated pages. Serve your app with these headers:

```
Cross-Origin-Opener-Policy: same-origin
Cross-Origin-Embedder-Policy: require-corp
```

Vite dev server ([apps/merge/vite.config.ts](../../apps/merge/vite.config.ts)). This is a schematic configuration fragment:

```ts schematic
export default defineConfig({
  server: {
    headers: {
      "Cross-Origin-Opener-Policy": "same-origin",
      "Cross-Origin-Embedder-Policy": "require-corp",
    },
  },
});
```

Vercel ([apps/merge/vercel.json](../../apps/merge/vercel.json)):

```json
{
  "headers": [
    {
      "source": "/(.*)",
      "headers": [
        { "key": "Cross-Origin-Opener-Policy", "value": "same-origin" },
        { "key": "Cross-Origin-Embedder-Policy", "value": "require-corp" }
      ]
    }
  ]
}
```

Note that `require-corp` blocks cross-origin resources (map tiles, fonts,
images) unless they send `Cross-Origin-Resource-Policy` or CORS headers.

#### Workers

`createRemote()` spawns the default worker from a URL relative to the `osmix`
module, which works when the package is loaded as plain ESM (Node, CDNs like
esm.sh, no-bundler setups). Bundlers usually cannot resolve that relative URL —
if the default worker fails to start, create a worker entry in your app and
pass it explicitly. With Vite:

```ts check-docs
// osm.worker.ts
import "osmix/worker";
```

This Vite-specific import is schematic because the `?worker&url` module is created by the bundler:

```ts schematic
import { createRemote } from "osmix";
import workerUrl from "./osm.worker.ts?worker&url";

const remote = await createRemote({
  workerUrl: new URL(workerUrl, import.meta.url),
});
```

#### Custom workers

Extend `OsmixWorker` to run your own methods next to the data:

The custom worker entry is schematic application wiring:

```ts schematic
// my.worker.ts
import { exposeOsmixWorker, OsmixWorker } from "osmix";

export class MyWorker extends OsmixWorker {
  countCafes(osmId: string) {
    return this.get(osmId).nodes.search("amenity", "cafe").length;
  }
}
void exposeOsmixWorker(new MyWorker());
```

The matching Vite client wiring is also schematic:

```ts schematic
import { createRemote } from "osmix";
import type { MyWorker } from "./my.worker.ts";
import workerUrl from "./my.worker.ts?worker&url";

const remote = await createRemote<MyWorker>({
  workerUrl: new URL(workerUrl, import.meta.url),
});
const cafes = await remote.runWithWorker((worker) => worker.countCafes(osmId), {
  lane: "compute",
  retry: "once",
});
```

`runWithWorker()` reserves an available worker until the operation settles. Use
the `control` lane for stateful sequences, and retry only read-only, replayable
operations. `getWorker()` remains available for compatibility but does not
participate in availability scheduling.

Worker restart recovery never retains a second copy of input bytes. Shared
datasets keep only their `SharedArrayBuffer` descriptors. In single-worker mode,
datasets loaded from a `File` are replayed from that same file reference, and
GeoParquet URLs or paths are reopened. Streams and raw buffers are one-shot
sources: if their worker is lost, the next retry rejects with
`OsmixDatasetLossError` instead of continuing against an empty worker. Custom
`OsmixRemote` subclasses can implement `recoverDataset()` and call
`registerDatasetForRecovery()` for application-owned durable sources such as
IndexedDB or a filesystem path. Mutating operations are never retried.
If a dataset transfer, rename, or deletion broadcast fails after only some
workers may have committed it, the pool is disposed and later calls reject with
`OsmixRemoteStateError` rather than reading divergent state.

Each base dataset has one active generated changeset. The latest successful call to `generateChangeset()`
or `generateConflationChangeset()` replaces that base's previous preview. After recovering the inputs, a
restarted control worker restores that latest preview and the current changeset filters; it does not replay
an older generation over it. Other base datasets retain their own previews. Changeset filters apply to all
active previews; candidate filters remain specific to their matching session.

Candidate review is independent of the active preview. Generating an ordinary changeset retains an otherwise
valid matching session and its decisions. Editing or clearing those decisions, starting a replacement matching
session, or calling `clearConflation()` invalidates only a preview generated from that session; a newer ordinary
preview remains available. Replacing, deleting, or renaming an input invalidates the review sessions and
generated previews that depend on it, including a dataset overwritten by a rename. Rerun discovery or
generation against the new inputs; recovery never revives the invalidated state.

#### Low-level worker pools

Applications with custom worker protocols can use the supported
`osmix/worker-pool` entrypoint directly:

```ts schematic
import { createOsmixWorkerPool } from "osmix/worker-pool";
import type { MyWorker } from "./my.worker.ts";

const pool = await createOsmixWorkerPool<MyWorker>({
  workerCount: 4,
  workerUrl: new URL("./my.worker.js", import.meta.url),
  restoreWorker: async (worker) => worker.restoreReadOnlyState(),
});

try {
  const result = await pool.run((worker, workerIndex) => worker.read(workerIndex), {
    priority: 10,
    retry: "once",
    signal: abortController.signal,
  });
} finally {
  await pool.dispose();
}
```

The pool provides stable priority/FIFO scheduling, worker affinity, bounded
startup/restoration/operation timeouts, queued aborts, one restart per slot,
opt-in retry-after-restart, and diagnostics. It does not know how to replicate
application state; supply `restoreWorker` when restarted workers need datasets
or derived indexes. A restoration error is preserved as the terminal slot error
so queued work sees the actual cause.

See [`MergeWorker`](../../apps/merge/src/workers/osm.worker.ts) for a real
example that adds IndexedDB storage.

#### Behavior differences by mode

- `remote.get(osmId)` reconstructs the dataset on the main thread: in
  multi-worker mode it shares the underlying `SharedArrayBuffer`s; otherwise
  the buffers are copied.
- Loading and merging synchronize datasets across the pool in multi-worker
  mode; in single-worker and in-process modes there is nothing to synchronize.
- Streams are transferred to workers when the browser supports transferable
  streams and buffered otherwise (`supportsReadableStreamTransfer()`).

`OsmixRemote` exposes the same helpers as the main import: `fromPbf`,
`fromGeoJSON`, `getVectorTile`, `getRasterTile`, `search`, `merge`,
`generateChangeset`, etc. Use `collectTransferables` + `transfer` when you
need to post Osmix payloads through your own worker setup.

### Routing with workers

`OsmixRemote` provides off-thread routing via `@osmix/router`. The routing graph
builds lazily on first use, so there's no upfront cost until you actually route.
Routing and way matching share [one-way normalization](../router/README.md#way-direction), also exposed as
`normalizedWayDirection(tags)`. Explicit `no`, `false`, and `0` override implicit roundabout direction.
Unsupported one-way values block way matching; the router's documented fallback remains an approximation.

```ts check-docs monaco-pbf
import { createRemote } from "osmix";

using remote = await createRemote();
const osm = await remote.fromPbf(monacoPbf);

// Find nearest routable nodes to coordinates
const from = await osm.findNearestRoutableNode([7.42, 43.73], 500);
const to = await osm.findNearestRoutableNode([7.43, 43.74], 500);

if (from && to) {
  // Calculate route with statistics and path info
  const result = await osm.route(from.nodeIndex, to.nodeIndex, {
    includeStats: true,
    includePathInfo: true,
  });

  if (result) {
    console.log(result.coordinates); // Route geometry
    console.log(result.distance); // Distance in meters
    console.log(result.time); // Time in seconds
    console.log(result.segments); // Per-way breakdown
  }
}
```

The routing graph is automatically shared across all workers when using
`SharedArrayBuffer`, so any worker can handle routing requests.

### Extract, stream, and write back to PBF

```ts check-docs pbf-output
import { fromPbf, createExtract, toPbfStream } from "osmix";

const monacoResponse = await fetch("./monaco.pbf");
const monacoPbf = new Uint8Array(await monacoResponse.arrayBuffer());
const osm = await fromPbf(monacoPbf);
const downtown = createExtract(osm, [-122.35, 47.6, -122.32, 47.62]);
await toPbfStream(downtown).pipeTo(fileWritableStream);
```

`createExtract` can either clip ways/members to the bbox (`strategy: "simple"`)
or include complete ways/relations. `toPbfStream` and `toPbfBuffer`
reuse the streaming builders from `@osmix/json`/`@osmix/pbf`, so outputs stay
spec-compliant without staging everything in memory.

## API

### Loading

- `fromPbf(data, options?)` - Load OSM data from PBF (buffer, stream, or File).
- `fromGeoJSON(data, options?)` - Load OSM data from GeoJSON.
- `readOsmPbfHeader(data)` - Read only the PBF header without loading entities.

### Export

- `toPbfStream(osm)` - Stream Osm to PBF bytes (memory-efficient).
- `toPbfBuffer(osm)` - Convert Osm to a single PBF buffer.

### Extraction

- `createExtract(osm, bbox, strategy?)` - Create geographic extract.
  - `"simple"` - Strict spatial cut.
  - `"complete_ways"` - Include complete way geometry.
  - `"smart"` - Complete ways + resolved multipolygons.

### Tiles

- `drawToRasterTile(osm, tile, tileSize?)` - Render Osm to raster tile.
  - Uses way `color`/`colour` tags when present to style line and area geometry.

### Workers (OsmixRemote)

- `createRemote(options?)` - Create a browser, Bun, Deno, or Node worker pool manager.
  - `options.workerCount` - Number of workers (default: all cores when SABs are shareable, else 1).
  - `options.workerUrl` - Custom worker entry (see [Workers](#workers)).
  - `options.inProcess` - Explicitly run on the calling thread (blocking; useful in tests).
  - `options.restoreTimeoutMs` - Bound replacement-worker rehydration time.
  - `options.workerRuntime` - Override automatic `"web" | "bun" | "deno" | "node"` selection.
- `getOsmixCapabilities()` - Inspect runtime support (workers, SAB sharing, max workers, recommended mode).
- `canShareArrayBuffers()` - Whether `SharedArrayBuffer`s can be posted between threads.
- `remote.mode` - Selected mode: `"multi-worker" | "single-worker" | "in-process"`.
- `await remote.dispose()` - Await worker shutdown; also available through `Symbol.asyncDispose`.
- `remote.runWithWorker(task, options?)` - Lease a managed `any`, `control`, or `compute` lane.
- `remote.fromPbf(data, options?)` - Load in worker.
- `remote.fromGeoJSON(data, options?)` - Load in worker.
- `remote.getVectorTile(osmId, tile)` - Generate MVT in worker.
- `remote.getRasterTile(osmId, tile, tileSize?)` - Generate raster in worker.
- `remote.merge(baseId, patchId, options?)` - Merge datasets in worker (legacy).
- `dataset.merge(patch, options?)` - Merge datasets via dataset handles.
- `remote.discoverConflation(baseId, patchId, options)` - Start a non-mutating imported-data match session.
- `remote.getConflationSummary(baseId)` - Retrieve decision-aware candidate counts.
- `remote.setConflationFilter(baseId, filter)` / `remote.getConflationPage(...)` - Page through candidate
  evidence and review state.
- `remote.setConflationDecision(baseId, decision)` / `remote.setConflationDecisions(...)` - Persist individual
  or batch review decisions.
- `remote.setConflationSourceDecision(baseId, source, selected)` - Atomically replace one imported feature's
  selected target, or leave it unmatched with `null`, preserving unrelated decisions.
- `remote.applyConflationBulkDecision(baseId, request)` - Atomically apply an action to all candidates matching
  the request's filter and return preview counts, the updated summary, and the complete decision snapshot.
- `remote.generateChangeset(baseId, patchId, options)` - Build an ordinary changeset that replaces the active
  preview for this base while retaining an otherwise valid matching session.
- `remote.generateConflationChangeset(baseId, mergeOptions)` - Build one cumulative direct, exact, and fuzzy
  changeset, replace the active preview for this base, and return routing diagnostics.
- `remote.clearConflation(baseId)` - Discard the active review session and any preview generated from it;
  retain a newer ordinary preview.
- `remote.applyChangesAndReplace(baseId)` - Apply the latest active preview and replace its base dataset.
- `remote.search(osmId, key, val?)` - Search by tag.
- `remote.toPbf(osmId, stream)` - Export to PBF.

#### Routing

- `remote.buildRoutingGraph(osmId, filter?, speeds?)` - Explicitly build routing graph (optional, builds lazily on first use).
- `remote.hasRoutingGraph(osmId)` - Check if routing graph exists.
- `remote.findNearestRoutableNode(osmId, point, maxDistanceM)` - Snap coordinate to nearest routable node.
- `remote.route(osmId, fromIndex, toIndex, options?)` - Calculate route between nodes.
  - `options.includeStats` - Include `distance` and `time` in result.
  - `options.includePathInfo` - Include `segments` and `turnPoints` in result.

### Utilities

- `collectTransferables(value)` - Find transferable buffers in nested objects.
- `transfer(data)` - Wrap data for zero-copy worker transfer.

## Related Packages

- [`@osmix/core`](../core/README.md) - In-memory OSM index with typed arrays and spatial queries.
- [`@osmix/load`](../load/README.md) - PBF loading, geographic extracts, and export.
- [`@osmix/pbf`](../pbf/README.md) - Low-level PBF reading and writing.
- [`@osmix/json`](../json/README.md) - PBF to JSON entity conversion.
- [`@osmix/geojson`](../geojson/README.md) - GeoJSON import/export.
- [`@osmix/change`](../change/README.md) - Changeset management and merge workflows.
- [`@osmix/raster`](../raster/README.md) - Raster tile rendering.
- [`@osmix/vt`](../vt/README.md) - Vector tile encoding.
- [`@osmix/router`](../router/README.md) - Pathfinding on OSM road networks.
- [`@osmix/shared`](../shared/README.md) - Shared utilities and types.

## Environment and limitations

- Requires runtimes that expose Web Streams plus modern typed array + compression
  APIs (Node 20+, Bun, current browsers). See
  [Environment support](#environment-support) for how `OsmixRemote` behaves
  with and without Web Workers and `SharedArrayBuffer`.
- `fromPbf` expects dense-node blocks; sparse node encodings are not yet supported.
- Raster helpers rely on `OffscreenCanvas` + `ImageData`.

## Development

- `pnpm run test packages/osmix`
- `pnpm run lint packages/osmix`
- `pnpm run typecheck packages/osmix`

Run `pnpm run check` from the repo root before publishing to keep formatting,
lint, and types consistent.
