# @osmix/raster

`@osmix/raster` paints entities into RGBA buffers sized for XYZ
tiles. It ships a single `OsmixRasterTile` class plus compositing helpers, so
you can render vector overlays into PNG/WebP tiles.

## Highlights

- Clamp + clip points, lines, and polygons to tile boundaries before painting.
- Compose repeated strokes using `compositeRGBA`, which blends in linear color
  space for predictable coverage.
- Build tiles entirely in workers or serverless handlers; outputs are just
  `Uint8ClampedArray`s you can wrap in `ImageData`.

## Installation

```sh
bun install @osmix/raster
```

## Usage

```ts
import {
	OsmixRasterTile
} from "@osmix/raster"

const tile = new OsmixRasterTile({
	tile: [9372, 12535, 15]
})

tile.drawPoint([-73.989, 40.733])
tile.drawLineString(
	[
		[-73.9892, 40.7326],
		[-73.9887, 40.7331],
		[-73.9883, 40.7336],
	]
)

const canvas = new OffscreenCanvas(tile.tileSize, tile.tileSize)
const ctx = canvas.getContext("2d")
ctx.putImageData(new ImageData(tile.imageData, tile.tileSize, tile.tileSize), 0, 0)
const pngBlob = await canvas.convertToBlob({ type: "image/png" })
```

`setLonLat`, `drawLineString`, `drawPolygon`, and `drawRelation` clamp geometry
to the tile bounds so you can pass raw OSM coordinates without pre-filtering.

### Display in Maplibre

See the [example merge app](/apps/merge/src/lib/osmix-raster-protocol.ts) for how to show raster tiles on a map.

## API

WIP

## Environment and limitations

- Tile painting assumes `[lon, lat]` coordinates in WGS84 order.

## Development

- `bun run test packages/raster`
- `bun run lint packages/raster`
- `bun run typecheck packages/raster`

Run `bun run check` at the repo root before publishing to ensure formatting,
lint, and type coverage.
