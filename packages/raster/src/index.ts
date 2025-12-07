/**
 * @osmix/raster - XYZ tile rasterization for OSM data.
 *
 * Provides tools for rendering OSM entities into RGBA pixel buffers for
 * XYZ tiles. Useful for generating preview tiles, heatmaps, or custom
 * raster overlays from vector OSM data.
 *
 * Key features:
 * - **Tile rendering**: Draw points, lines, and polygons into tile buffers.
 * - **Coordinate projection**: Convert lon/lat to tile pixels automatically.
 * - **Clipping**: Geometry is clipped to tile bounds.
 * - **Compositing**: Proper alpha blending in linear color space.
 *
 * @example
 * ```ts
 * import { OsmixRasterTile } from "@osmix/raster"
 *
 * const tile = new OsmixRasterTile({ tile: [9372, 12535, 15], tileSize: 256 })
 * tile.drawPoint([-73.989, 40.733])
 * tile.drawLineString([[-73.99, 40.73], [-73.98, 40.74]])
 *
 * const imageData = new ImageData(tile.imageData, tile.tileSize, tile.tileSize)
 * ```
 *
 * @module @osmix/raster
 */

export * from "./raster-tile"
