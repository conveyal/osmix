export type LonLat = [lon: number, lat: number]
export type XY = [x: number, y: number]
export interface ILonLat {
	lon: number
	lat: number
}
export type Tile = [x: number, y: number, z: number]

/**
 * Project LonLat to pixels
 */
export type LonLatToPixel = (ll: LonLat, zoom: number) => XY

export type LonLatToTilePixel = (ll: LonLat, z: number, extent: number) => XY

export type Rgba = [number, number, number, number] | Uint8ClampedArray

/**
 * A bounding box in the format [minLon, minLat, maxLon, maxLat].
 * GeoJSON.BBox allows for 3D bounding boxes, but we use tools that expect 2D bounding boxes.
 */
export type GeoBbox2D = [
	minLon: number,
	minLat: number,
	maxLon: number,
	maxLat: number,
]
