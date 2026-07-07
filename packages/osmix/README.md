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

```ts
import { fromPbf, fromGeoJSON, toPbfBuffer } from "osmix";

const monacoPbf = await Bun.file("./monaco.pbf").arrayBuffer();
const osm = await fromPbf(monacoPbf);

console.log(osm.nodes.size, osm.ways.size, osm.relations.size);

const geojsonFile = await fetch("/fixtures/buildings.geojson").then((r) => r.arrayBuffer());
const geoOsm = await fromGeoJSON(geojsonFile);
const pbfBytes = await toPbfBuffer(geoOsm);
```

### Work off the main thread with `OsmixRemote`

```ts
import { createRemote } from "osmix";

const remote = await createRemote();
const monaco = await remote.fromPbf(monacoPbf);
const patch = await remote.fromPbf(patchPbfStream, { id: "patch" });
const merged = await monaco.merge(patch);
const rasterTile = await merged.getRasterTile([10561, 22891, 16]);
```

#### Which mode am I in?

`createRemote()` picks the best mode the current runtime supports and reports
it via `remote.mode`. Use `getOsmixCapabilities()` to inspect the runtime
before creating a remote:

```ts
import { createRemote, getOsmixCapabilities } from "osmix";

console.log(getOsmixCapabilities());
// { webWorkers: true, canShareArrayBuffers: false, maxWorkers: 1, recommendedMode: "single-worker", ... }

const remote = await createRemote();
console.log(remote.mode, remote.workerCount); // "single-worker", 1
```

#### Environment support

| Environment                                       | Mode            | Behavior                                                           |
| ------------------------------------------------- | --------------- | ------------------------------------------------------------------ |
| Browser, [cross-origin isolated][coi]             | `multi-worker`  | One worker per core; datasets shared via `SharedArrayBuffer`       |
| Browser, not isolated (no COOP/COEP headers)      | `single-worker` | One worker; data is transferred/copied instead of shared           |
| No Web Workers (Node, restricted runtimes)        | throws          | Pass `inProcess: true` or use the main-thread API (`fromPbf`, ...) |
| `createRemote({ inProcess: true })` (Node, tests) | `in-process`    | Same API on the calling thread; long operations block that thread  |

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

Vite dev server ([apps/merge/vite.config.ts](../../apps/merge/vite.config.ts)):

```ts
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

```ts
// osm.worker.ts
import "osmix/worker";
```

```ts
import { createRemote } from "osmix";
import workerUrl from "./osm.worker.ts?worker&url";

const remote = await createRemote({
  workerUrl: new URL(workerUrl, import.meta.url),
});
```

#### Custom workers

Extend `OsmixWorker` to run your own methods next to the data:

```ts
// my.worker.ts
import { expose } from "comlink";
import { OsmixWorker } from "osmix";

export class MyWorker extends OsmixWorker {
  countCafes(osmId: string) {
    return this.get(osmId).nodes.search("amenity", "cafe").length;
  }
}
expose(new MyWorker());
```

```ts
import { createRemote } from "osmix";
import type { MyWorker } from "./my.worker.ts";
import workerUrl from "./my.worker.ts?worker&url";

const remote = await createRemote<MyWorker>({
  workerUrl: new URL(workerUrl, import.meta.url),
});
const cafes = await remote.getWorker().countCafes(osmId);
```

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

```ts
import { createRemote } from "osmix";

const remote = await createRemote();
const osm = await remote.fromPbf(monacoPbf);

// Find nearest routable nodes to coordinates
const from = await osm.findNearestRoutableNode([7.42, 43.73], 0.5);
const to = await osm.findNearestRoutableNode([7.43, 43.74], 0.5);

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

```ts
import { fromPbf, createExtract, toPbfStream } from "osmix";

const osm = await fromPbf(Bun.file("./monaco.pbf").stream());
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

- `createRemote(options?)` - Create worker pool manager.
  - `options.workerCount` - Number of workers (default: all cores when SABs are shareable, else 1).
  - `options.workerUrl` - Custom worker entry (see [Workers](#workers)).
  - `options.inProcess` - Run on the calling thread (Node, tests).
- `getOsmixCapabilities()` - Inspect runtime support (workers, SAB sharing, max workers, recommended mode).
- `canShareArrayBuffers()` - Whether `SharedArrayBuffer`s can be posted between threads.
- `remote.mode` - Selected mode: `"multi-worker" | "single-worker" | "in-process"`.
- `remote.fromPbf(data, options?)` - Load in worker.
- `remote.fromGeoJSON(data, options?)` - Load in worker.
- `remote.getVectorTile(osmId, tile)` - Generate MVT in worker.
- `remote.getRasterTile(osmId, tile, tileSize?)` - Generate raster in worker.
- `remote.merge(baseId, patchId, options?)` - Merge datasets in worker (legacy).
- `dataset.merge(patch, options?)` - Merge datasets via dataset handles.
- `remote.search(osmId, key, val?)` - Search by tag.
- `remote.toPbf(osmId, stream)` - Export to PBF.

#### Routing

- `remote.buildRoutingGraph(osmId, filter?, speeds?)` - Explicitly build routing graph (optional, builds lazily on first use).
- `remote.hasRoutingGraph(osmId)` - Check if routing graph exists.
- `remote.findNearestRoutableNode(osmId, point, maxKm)` - Snap coordinate to nearest routable node.
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
