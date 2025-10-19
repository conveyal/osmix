# @osmix/raster

@osmix/raster turns OpenStreetMap geometries into lightweight raster tiles you can serve to MapLibre, Leaflet, or any viewer that can render PNG tiles. It ships a canvas-backed tile renderer plus a MapLibre protocol helper so you can generate imagery on demand in modern runtimes (Node 20+, Bun, browsers, and workers) using datasets sourced from [`@osmix/core`](../core/README.md).

## Highlights

- Paint nodes and ways from `@osmix/core` datasets into RGBA buffers with a tiny API (`setLonLat`, `drawWay`, `setPixel`).
- Automatically clip ways to the tile bounds before rasterization so edges stay clean.
- Export tiles through `OffscreenCanvas` with configurable image encoders (PNG, WebP, etc.).
- Register a custom `@osmix/raster://` protocol in MapLibre and stream tiles without a tile server.
- Built on Web APIs and `@mapbox/sphericalmercator` so you can run the same code in workers or serverless handlers.

## Installation

```sh
npm install @osmix/raster
```

## Usage

### Render a tile off the main thread

Use `OsmixRasterTile` to paint nodes or ways into an RGBA buffer and encode it with the format of your choice.

```ts
import { OsmixRasterTile, DEFAULT_TILE_SIZE } from "@osmix/raster"
import { SphericalMercator } from "@mapbox/sphericalmercator"

const tileIndex = { z: 15, x: 9372, y: 12535 }
const merc = new SphericalMercator({ size: DEFAULT_TILE_SIZE })
const bbox = merc.bbox(tileIndex.x, tileIndex.y, tileIndex.z)

const tile = new OsmixRasterTile(bbox, tileIndex)

tile.setLonLat([-73.989, 40.733]) // default node color (red)
tile.drawWay(
	[
		[-73.9892, 40.7326],
		[-73.9887, 40.7331],
		[-73.9883, 40.7336],
	],
)

const pngBytes = await tile.toImageBuffer({ type: "image/png" })
```

`setLonLat` + `drawWay` clamp to tile bounds, so you can safely pass geometries that extend outside the tile and only the visible portion will be drawn.

### Plug into MapLibre with a custom protocol

Generate tiles on demand by registering the bundled protocol factory. It parses URLs shaped like `@osmix/raster://<osmId>/<tileSize>/<z>/<x>/<y>.png` and hands you the derived tile metadata to render or fetch bytes however you like.

```ts
import maplibregl from "maplibre-gl"
import { createOsmixRasterMaplibreProtocol } from "@osmix/raster"

maplibregl.addProtocol(
	"@osmix/raster",
	createOsmixRasterMaplibreProtocol(async (osmId, bbox, tileIndex, tileSize) => {
		// Render with OsmixRasterTile, cache lookups, or proxy to another service.
		const tile = new OsmixRasterTile(bbox, tileIndex, tileSize)
		// ...paint nodes/ways...
		return {
			data: await tile.toImageBuffer(),
			contentType: "image/png",
		}
	}),
)
```

## API overview

- `OsmixRasterTile(bbox, tileIndex, tileSize?)` – Paint pixels for a single tile; exposes `setLonLat`, `setPixel`, `drawLine`, `drawWay`, `toCanvas`, and `toImageBuffer`.
- Constants: `DEFAULT_TILE_SIZE`, `DEFAULT_RASTER_IMAGE_TYPE`, `DEFAULT_NODE_COLOR`, `DEFAULT_WAY_COLOR`.
- `createOsmixRasterMaplibreProtocol(getTileImage, tileSize?)` – Returns the callback you can pass to `maplibregl.addProtocol`. It validates URLs, computes a WGS84 bbox, and forwards `tileIndex` + `tileSize`.

## See also

- [`@osmix/core`](../core/README.md) – Provides the indexed geometry and transferables you can paint into tiles.
- [Osmix Merge app](../../apps/merge/README.md) – Uses the raster helpers in a worker to preview merge states.
- [`@osmix/change`](../change/README.md) – Generates the deduplicated datasets you may wish to visualize.

## Environment and limitations

- Requires runtimes with `OffscreenCanvas`, `ImageData`, `ImageEncoder` APIs, and typed-array support. In Node/Bun, use recent versions (Node 20+, Bun 1.0+) which expose these in workers.
- The MapLibre protocol helper expects URLs that exactly match the documented template; it throws on malformed paths.
- Clipping uses the `lineclip` library and assumes geometries are provided in `[lon, lat]` order.

## Development

- `bun run test packages/raster`
- `bun run lint packages/raster`
- `bun run typecheck packages/raster`

Run `bun run check` at the repo root before publishing to ensure formatting, lint, and type coverage.
