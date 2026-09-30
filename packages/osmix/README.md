# osmix

`osmix` is the high-level entrypoint for the Osmix toolkit. It layers ingestion,
streaming, and worker orchestration utilities on top of the low-level
`@osmix/core` index so you can load `.osm.pbf` files, convert GeoJSON, and
request raster/vector tiles with a single import. PBF loading, extraction, and
export live in [`@osmix/load`](../load/README.md) and are re-exported here.

The [merge-process guide](../../docs/merge-process.md) defines merge behavior and known limitations across the library, workers, and app. This README describes how to call the facade and worker APIs.

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

Worker merge replaces the loaded base and removes the loaded patch; original source files remain unchanged. The [merge-process guide](../../docs/merge-process.md#inputs-and-identity) distinguishes source files, loaded state, and same-ID updates. See its [exact reconciliation](../../docs/merge-process.md#direct-and-exact-rules) and [intersection](../../docs/merge-process.md#intersections-and-validation) rules for geometry changes.

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

Each run records the plan's phases (`plan-direct`, `plan-identity`, `plan-matching`, `plan-crossings`,
`plan-check`) and the single build (`apply-plan`).

Yakima requires `fixtures/yakima-full.osm.pbf` and `fixtures/yakima.osw.pbf`. Eastern Washington requires
`fixtures/osmix-e_wa_osm.pbf` and `fixtures/east_washington_sidewalk_proviso_1.pbf`. The existing Eastern
Washington correctness test remains opt-in with `OSMIX_EASTERN_WASHINGTON_INTEGRATION=1`.

`OSMIX_MERGE_PROFILE_SCENARIO`, `OSMIX_MERGE_PROFILE_RUNS`, and `OSMIX_MERGE_PROFILE_OUTPUT` are equivalent
to the command-line flags. Compare reports produced with the same commit, Node version, hardware, and idle
system. `processPeakRssBytes` is the process-lifetime high-water mark, so later repetitions can retain an
earlier run's peak. CI verifies operation counts and semantic fingerprints, but intentionally has no timing
threshold or compressed-PBF byte golden.

### Plan and review a merge

`merge()` plans and applies in one call. To review first, plan in the worker, page through the imported
features, decide the proposals that need you, and apply. Nothing changes until `applyMergePlan()`:

```ts check-docs worker-pbf-inputs
import { createRemote } from "osmix";

using remote = await createRemote();
const base = await remote.fromPbf(monacoPbf);
const patch = await remote.fromPbf(patchPbf, { id: "imported-data" });

const plan = await remote.planMerge(base.id, patch.id, {
  matching: { propertyKeys: ["name", "operator", "surface"], attachNetwork: true },
});
console.log(plan.summary.features, plan.diagnostics.routing.car.delta);

// Features that need a decision come first.
await remote.setMergePlanFilter(base.id, { outcome: "needs-decision" });
const page = await remote.getMergePlanPage(base.id, 0, 25);
const proposal = page.features[0]?.proposals.find((item) => item.status === "review");
if (proposal) {
  await remote.setMergePlanDecisions(base.id, [{ proposalId: proposal.id, action: "accept" }]);
}

const osc = await remote.getMergePlanOsc(base.id);
const applied = await remote.applyMergePlan(base.id);
console.log(osc.length, applied.summary.features);
```

`setMergePlanDecisions()` replaces every decision and replans only the phases they affect.
`applyMergePlanBulk(baseId, { action, filter })` accepts, rejects, or clears decisions for every proposal the
filter matches; accepting skips proposals with alternatives, which need an individual choice.
`getMergePlanFeature()` returns one feature's matching evidence and the geometry of the base entities its
proposals target, and `getMergePlanTile(baseId, tile)` draws the imported features as a vector tile, with a
`ways` and a `nodes` layer (`PLAN_TILE_LAYERS`) whose features carry `featureKey` and their current `outcome`, so
a map can show a plan of any size. The plan's rules are in the [merge-process guide](../../docs/merge-process.md).

After a worker restart the remote rebuilds each plan from its inputs, options, and decisions, but only when
the restored inputs have the content hashes the plan was made from; otherwise it throws
`OsmixPlanRecoveryError` and the plan must be made again.

If `applyMergePlan()`, `applyChangesAndReplace()`, or `merge()` updates the control worker but then fails to
synchronize or retrieve the result, it throws `OsmixCommittedMutationError`. Its enumerable fields include
`committed: true`, `operation`, and the surviving result's `osmId`; `cause` retains the underlying error. Do
not repeat the mutation. Await `remote.synchronizeDataset(error.osmId)`, then retrieve and refresh that
result. Terminal worker-pool failures remain terminal; a new session must load the original inputs again.

Inspect's duplicate fixes use `planDeduplication(osmId)`: the changes open in `getChangesetPage()` and apply
with `applyChangesAndReplace()`.

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
| Node 24+                                     | worker threads  | Runs off-thread; shared buffers enable multi-worker datasets      |
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

Vite dev server ([apps/app/vite.config.ts](../../apps/app/vite.config.ts)). This is a schematic configuration fragment:

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

Vercel ([apps/app/vercel.json](../../apps/app/vercel.json)):

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

A restarted control worker rebuilds each active merge plan and each dataset's duplicate fixes from the
recovered inputs, and restores the current changeset filters. A plan whose restored inputs differ from the
ones it was made from is dropped with `OsmixPlanRecoveryError` after everything else is restored.

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

See [`MergeWorker`](../../apps/app/src/workers/osm.worker.ts) for a real
example that adds IndexedDB storage.

#### Behavior differences by mode

- `remote.get(osmId)` reconstructs the dataset on the main thread: in
  multi-worker mode it shares the underlying `SharedArrayBuffer`s; otherwise
  the buffers are copied.
- Loading and merging synchronize datasets across the pool in multi-worker
  mode; in single-worker and in-process modes there is nothing to synchronize.
- Streams are transferred to workers when the browser supports transferable
  streams (`supportsReadableStreamTransfer()`). Otherwise `remote.toPbf` pipes a
  worker-built `Blob`, so serialization stays off the main thread.

`OsmixRemote` exposes the same helpers as the main import: `fromPbf`,
`fromGeoJSON`, `getVectorTile`, `getRasterTile`, `search`, `merge`,
`planMerge`, `getMergePlanPage`, `applyMergePlan`, etc. Use `collectTransferables` + `transfer` when you
need to post Osmix payloads through your own worker setup.

### Routing with workers

`OsmixRemote` provides off-thread routing via `@osmix/router`. The routing graph
builds lazily on first use, so there's no upfront cost until you actually route.
Routing and way matching share [one-way normalization](../router/README.md#way-direction), also exposed as
`normalizedWayDirection(tags)`. Explicit `no`, `false`, and `0` override implicit roundabout direction.
Unsupported one-way values block way matching; the router's documented fallback remains an approximation.

Routing regression reports distinguish OSM node-ID lookup from coordinate snapping and list the checks actually evaluated: declared reachability, metric bounds, required/forbidden way IDs, and prohibited transitions where specified. Unresolved endpoints make route checks unavailable; they do not prove that a route is unreachable. Policy-limitation witnesses are reported separately and do not count as passed legality checks. Dijkstra/A* agreement and unchanged graph counts do not prove complete access or turn-restriction behavior. The [optional local R5 runner](test/r5/README.md) provides separately scoped comparison evidence; normal package and CI tests require neither R5 nor large local fixtures.

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
or include complete ways/relations. No strategy removes members from a turn restriction: a restriction the extract would cut is dropped, or completed under `"smart"`. `toPbfStream` and `toPbfBuffer`
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
  - `"smart"` - Complete ways + resolved multipolygons and turn restrictions.

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
- `remote.merge(baseId, patchId, options?)` - Plan and apply a merge in one call.
- `dataset.merge(patch, options?)` - Merge datasets via dataset handles.
- `remote.planMerge(baseId, patchId, options?)` - Plan a merge for review; returns its overview.
- `remote.getMergePlanOverview(baseId)` / `remote.getMergePlanPage(baseId, page, pageSize)` /
  `remote.setMergePlanFilter(baseId, filter)` - Read the plan and page through its imported features.
- `remote.getMergePlanFeature(baseId, featureKey)` / `remote.getMergePlanTile(baseId, tile, signal?)` - One
  feature's evidence, and a vector tile of the imported features with their current outcomes.
- `remote.getMergeMatchingPage(baseId, filter, page, pageSize)` /
  `remote.getMergeUncopiedTagPage(baseId, key, page, pageSize)` - The matching outcome's per-feature lists,
  which the overview only counts (`matching.outcome.tags[].uncopiedFeatures`, `wayRemovalFeatures`) because they
  can hold an entry for every imported feature. `filter` is `"unresolved"`, `"skipped"`, `"way-removal"` or
  `"all"`. After `applyMergePlan` they stay readable for the completed merge until the next plan or
  `clearMergePlan` for that base.
- `remote.setMergePlanDecisions(baseId, decisions)` / `remote.applyMergePlanBulk(baseId, request)` - Decide
  proposals and replan.
- `remote.getMergePlanOsc(baseId)` - The plan as an osmChange document.
- `remote.applyMergePlan(baseId)` / `remote.clearMergePlan(baseId)` - Apply or discard the plan.
- `remote.planDeduplication(osmId)` - Find duplicates inside one dataset for the changeset pages.
- `remote.applyChangesAndReplace(osmId)` - Apply the duplicate fixes and replace the dataset.
- `remote.synchronizeDataset(osmId)` - Synchronize an already committed result after a reported
  `OsmixCommittedMutationError`, without generating or applying changes again.
- `remote.search(osmId, key, val?)` - Search by tag.
- `remote.toPbf(osmId, stream)` - Export to PBF.
- `remote.toPbfFile(osmId, fileHandle)` - Write PBF through a `FileSystemFileHandle` (for example from `showSaveFilePicker()`). The worker writes to the file directly, so transferable streams are not required.
- `remote.toPbfBlob(osmId)` - Serialize to a PBF `Blob` in a worker, for a browser download.

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
  APIs (Node 24+, Bun, current browsers). See
  [Environment support](#environment-support) for how `OsmixRemote` behaves
  with and without Web Workers and `SharedArrayBuffer`.
- `fromPbf` expects dense-node blocks; sparse node encodings are not yet supported.
- Raster helpers rely on `OffscreenCanvas` + `ImageData`.
- Datasets live in memory. After a load, a dataset uses about 5× its PBF file size; the load peak is about 6× to 7×. In a browser, files up to about 500 MB load with all features, and up to about 1 GB with the View profile. One way or relation holds at most 65,535 refs or members (`OsmCapacityError`). The router does not model turn restrictions or access tags. See [docs/limits.md](../../docs/limits.md).

## Development

- `pnpm run test packages/osmix`
- `pnpm run lint packages/osmix`
- `pnpm run typecheck packages/osmix`

Run `pnpm run check` from the repo root before publishing to keep formatting,
lint, and types consistent.
