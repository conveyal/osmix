# @osmix/vt

`@osmix/vt` converts `@osmix/core` OSM into Mapbox Vector Tiles.

## Installation

```sh
bun install @osmix/vt
```

## Usage

### Encode a single vector tile from an Osm dataset

```ts
import { Osm } from "@osmix/core"
import { OsmixVtEncoder } from "@osmix/vt"

// Load your Osm dataset
const osm = await Osmix.fromPbf(Bun.file('./monaco.pbf').stream())

// Create an encoder. Defaults: extent=4096, buffer=64px
const encoder = new OsmixVtEncoder(osm)

// XYZ tile tuple: [x, y, z]
const tile: [number, number, number] = [9372, 12535, 15]

// Returns an ArrayBuffer containing up to three layers:
// "@osmix:<id>:ways", "@osmix:<id>:nodes", "@osmix:<id>:relations"
const pbfBuffer = encoder.getTile(tile)
```

### Displaying in a browser (manual Blob URL)

Most viewers expect tile URLs. To see a Maplibre implementation in the [example merge app](/apps/merge/src/lib/osmix-vector-protocol.ts).

## What gets encoded

- Ways become LINE features; AREA-like ways (per `wayIsArea`) become POLYGON features.
- Multipolygon relations render as POLYGON features in a dedicated layer so holes and shared ways stay intact.
- Nodes with tags become POINT features. Untagged nodes are skipped.
- Each feature includes properties `{ type: "node" | "way" | "relation", ...tags }` and `id`.
- Three layers are emitted per tile: `@osmix:<datasetId>:ways`, `@osmix:<datasetId>:nodes`, and `@osmix:<datasetId>:relations` (empty layers are omitted automatically).

## API

### `OsmixVtEncoder`

The main class for encoding vector tiles.

```ts
constructor(osm: Osm, extent = 4096, buffer = 64)
```

- `osm`: The `@osmix/core` dataset to encode.
- `extent`: Tile extent (default 4096). Higher values offer more precision.
- `buffer`: Buffer around the tile in extent units (default 64).

#### `getTile(tile: [x, y, z]): ArrayBuffer`

Encodes a single tile identified by its XYZ coordinates. Returns a PBF `ArrayBuffer`.

#### `getTileForBbox(bbox: [w, s, e, n], proj: (ll) => [x, y]): ArrayBuffer`

Lower-level method to encode a specific bounding box with a custom projection function. Useful if you are projecting to non-Mercator tiles or need custom bounds.

## Environment and limitations

- Designed for modern runtimes (Node 20+, Bun, browser workers). Uses typed arrays throughout.
- Multipolygon relations are supported, but other relation types are skipped.
- Ways are clipped to tile bounds; nodes outside the tile are omitted.
- Extent defaults to 4096; set a larger extent if you need higher precision.

### Tags and metadata

- Feature properties include the OSM tags available in the source dataset. Styling keys can be derived at ingestion time; for very large tag sets consider pre-filtering to a stable subset to keep tile size reasonable.

## Related Packages

- [`@osmix/core`](../core/README.md) – In-memory index used to source node/way geometry.
- [`@osmix/shared`](../shared/README.md) – Supplies `wayIsArea` heuristics and entity types.
- [`@osmix/raster`](../raster/README.md) – Raster tile rendering if you prefer PNG/WebP output.
- [`osmix`](../osmix/README.md) – High-level API with `getVectorTile()` helper.

## Development

- `bun run test packages/vt`
- `bun run lint packages/vt`
- `bun run typecheck packages/vt`

Run `bun run check` at the repo root before publishing to ensure formatting, lint, and type coverage.
