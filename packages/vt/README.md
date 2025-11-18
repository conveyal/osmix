# @osmix/vt

`@osmix/vt` converts Osmix binary overlays (typed-array node and way payloads) into Mapbox Vector Tiles. It also ships a lightweight tile index with LRU caching so workers or web apps can request tiles on demand without re-projecting data for every request.

## Installation

```sh
npm install @osmix/vt
```

## Usage

### Encode a single vector tile from an Osmix dataset

```ts
import { Osmix } from "osmix"
import { OsmixVtEncoder } from "@osmix/vt"

// Load or build an Osmix dataset (indexed nodes/ways/relations)
const osm = await Osmix.fromPbf(fetch("/fixtures/monaco.pbf").then((r) => r.arrayBuffer()))

// Create an encoder. Defaults: extent=4096, buffer=64px
const encoder = new OsmixVtEncoder(osm)

// XYZ tile tuple: [x, y, z]
const tile: [number, number, number] = [9372, 12535, 15]

// Returns an ArrayBuffer containing up to three layers:
// "@osmix:<id>:ways", "@osmix:<id>:nodes", "@osmix:<id>:relations"
const pbfBuffer = encoder.getTile(tile)

// Persist or send somewhere
await Deno.writeFile("tile.mvt", new Uint8Array(pbfBuffer))
```

### Custom bounding box and projection

If you already have a WGS84 bbox and a lon/lat → tile-pixel projection, you can render directly:

```ts
import { OsmixVtEncoder, projectToTile } from "@osmix/vt"

const encoder = new OsmixVtEncoder(osm, 4096, 64)
const bbox: [number, number, number, number] = [-73.99, 40.73, -73.98, 40.74]
const proj = projectToTile([9372, 12535, 15], 4096)

const pbf = encoder.getTileForBbox(bbox, proj)
```

### Displaying in a browser (manual Blob URL)

Most viewers expect tile URLs. For quick inspection, you can create a Blob URL for a single tile:

```ts
const buf = encoder.getTile([9372, 12535, 15])
const url = URL.createObjectURL(new Blob([buf], { type: "application/x-protobuf" }))
// Use `url` anywhere a single MVT URL is accepted (debug tooling, downloads, etc.)
```

For full map integration, serve tiles from a handler that calls `getTile([x,y,z])` and returns the bytes. MapLibre/Mapbox GL can then point a `vector` source at `https://your-host/tiles/{z}/{x}/{y}.mvt`.

## What gets encoded

- Ways become LINE features; AREA-like ways (per `wayIsArea`) become POLYGON features.
- Multipolygon relations render as POLYGON features in a dedicated layer so holes and shared ways stay intact.
- Nodes with tags become POINT features. Untagged nodes are skipped.
- Each feature includes properties `{ type: "node" | "way" | "relation", ...tags }` and `id`.
- Three layers are emitted per tile: `@osmix:<datasetId>:ways`, `@osmix:<datasetId>:nodes`, and `@osmix:<datasetId>:relations` (empty layers are omitted automatically).

## API overview

- `class OsmixVtEncoder(osm: Osm, extent=4096, buffer=64)`
  - `getTile(tile: [x, y, z]): ArrayBuffer` – Encodes a tile using internal bbox/projection.
  - `getTileForBbox(bbox, proj): ArrayBuffer` – Encode for a WGS84 bbox with a lon/lat → tile-pixel projector.
  - Internals expose generators for `nodeFeatures`, `wayFeatures`, and `relationFeatures` if you need to post-process.
- `projectToTile(tile: [x, y, z], extent=4096): (lonLat) => [x, y]` – Helper to build a projector matching the encoder.
- Types (from `src/types.ts`):
  - `VtSimpleFeature` – `{ id, type, properties, geometry }`
  - `VtPbfLayer` – `{ name, version, extent, features }`

## Environment and limitations

- Designed for modern runtimes (Node 20+, Bun, browser workers). Uses typed arrays throughout.
- Multipolygon relations are supported, but other relation types are skipped.
- Ways are clipped to tile bounds; nodes outside the tile are omitted.
- Extent defaults to 4096; set a larger extent if you need higher precision.

### Tags and metadata

- Feature properties include the OSM tags available in the source dataset. Styling keys can be derived at ingestion time; for very large tag sets consider pre-filtering to a stable subset to keep tile size reasonable.

## See also

- `@osmix/core` – In-memory index used to source node/way geometry.
- `@osmix/json` – Supplies `wayIsArea` heuristics and entity types used by the encoder.
- `@osmix/raster` – If you prefer raster previews or a protocol helper for MapLibre.
