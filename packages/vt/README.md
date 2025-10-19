# @osmix/vt

`@osmix/vt` converts Osmix binary overlays (typed-array node and way payloads) into Mapbox Vector Tiles. It also ships a lightweight tile index with LRU caching so workers or web apps can request tiles on demand without re-projecting data for every request.

## Highlights

- Encode node/way buffers from [`@osmix/core`](../core/README.md) straight into vector tiles with configurable extent, buffer, and layer prefixes.
- Cache rendered tiles with a capped LRU map to avoid repeated work when panning or zooming.
- Optionally stamp tiles with dataset identifiers and tile keys so client-side tooling can correlate debug output.
- Re-use the same helpers in browsers, workers, Bun, or Node 20+ (no native bindings required).

## Installation

```sh
npm install @osmix/vt
```

## Usage

```ts
import { createBinaryVtIndex } from "@osmix/vt"

const index = createBinaryVtIndex(async ({ bbox, tileIndex }) => {
	const payload = osm.getBinaryTilePayload(bbox) // implement using @osmix/core helpers
	return payload
}, {
	datasetId: "monaco",
	layerPrefix: "osmix",
	includeTileKey: true,
})

const tile = await index.getTile({ z: 14, x: 8272, y: 5748 })
if (tile) {
	// Persist tile ArrayBuffer, return via HTTP, etc.
}
```

The index caches recent tiles. Call `invalidate(tileIndex)` or `clearCache()` when underlying data changes.

## API overview

- `createBinaryVtIndex(loader, options)` – Instantiate the cached index. `loader` receives `{ bbox, tileIndex }` and returns `BinaryTilePayload | null`.
- `encodeBinaryTile(payload, options)` – Convert a node/way payload into a `{ data, tileKey, extent }` tuple ready for serialization.
- Types: `BinaryVtIndex`, `BinaryTilePayload`, `TileIndex`, `TileDebugInfo`, and option objects for both helpers.

## Known limitations

- Only node and way geometries are encoded today; relation support (multipolygons, routes, etc.) is not implemented.
- Tile clipping currently uses an extent/buffer calculated from the configured values rather than the precise tile bounding box (`encodeBinaryTile` notes this TODO). Sharp features at tile edges may show slight offsets.
- Tags are not propagated into the vector tile output; add them to the payload and extend `encodeBinaryTile` if you need style-driven metadata.
- Cache entries are stored in-memory; flush them explicitly in long-running server contexts to avoid unbounded growth.
