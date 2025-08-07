import { Osm, type GeoBbox2D, type TileIndex } from "osm.ts"
import * as Performance from "osm.ts/performance"
import { expose, transfer } from "comlink"
import type { _TileLoadProps } from "@deck.gl/geo-layers"
import { MIN_PICKABLE_ZOOM } from "@/settings"
// import {lngLatToWorld} from '@math.gl/web-mercator'

const osmWorker = {
	subscribeToPerformanceObserver(
		onEntry: (
			entryType: string,
			name: string,
			startTime: number,
			duration: number,
			detail: unknown | undefined,
			timeOrigin: number,
		) => void,
	) {
		// Create once; batch each observer callback
		const observer = new PerformanceObserver((list) => {
			for (const entry of list.getEntries()) {
				onEntry(
					entry.entryType,
					entry.name,
					entry.startTime,
					entry.duration,
					"detail" in entry ? entry.detail : undefined,
					performance.timeOrigin,
				)
			}
		})

		observer.observe({ entryTypes: ["mark", "measure"] })
	},
	osm(id: string) {
		if (!this.ids[id]) throw Error("Osm not loaded.")
		return this.ids[id]
	},
	ids: {} as Record<string, Osm>,
	async initFromPbfData(
		id: string,
		data: ArrayBuffer | ReadableStream<Uint8Array>,
		onProgress: (...args: string[]) => void,
	) {
		// By default, delete all existing OSM instances
		for (const id in this.ids) {
			delete this.ids[id]
		}
		const measure = Performance.createMeasure("initializing PBF from data")
		const osm = new Osm()
		this.ids[id] = osm
		await osm.initFromPbfData(data, onProgress)
		measure()
	},
	bbox(id: string) {
		return this.osm(id).bbox()
	},
	info(id: string) {
		const osm = this.osm(id)
		const bbox = osm.bbox()
		if (!bbox) throw Error("Osm not loaded. No bbox.")
		return {
			bbox,
			nodes: osm.nodes.size,
			ways: osm.ways.size,
			relations: osm.relations.size,
			header: osm.header,
			parsingTimeMs: osm.parsingTimeMs,
		}
	},
	getNode(id: string, index: number) {
		return this.osm(id).nodes.getByIndex(index)
	},
	getWay(id: string, index: number) {
		const way = this.osm(id).ways.getByIndex(index)
		if (!way) return null
		return {
			way,
			nodes: this.osm(id).nodes.getEntitiesById(way.refs),
		}
	},
	async getTileData(
		id: string,
		bbox: GeoBbox2D,
		tileIndex: TileIndex,
		tileSize = 512,
	) {
		try {
			const measure = Performance.createMeasure(
				`generating tile data ${tileIndex.z}/${tileIndex.x}/${tileIndex.y}`,
			)
			const nodeResults =
				tileIndex.z > MIN_PICKABLE_ZOOM
					? this.osm(id).getNodesInBbox(bbox)
					: {
							indexes: new Uint32Array(0),
							positions: new Float32Array(0),
						}
			const wayResults = this.osm(id).getWaysInBbox(bbox)
			const bitmap =
				tileIndex.z < MIN_PICKABLE_ZOOM
					? rasterizeWaysToBitmap(bbox, wayResults, tileSize)
					: null
			measure()
			return transfer(
				{
					nodes: nodeResults,
					bitmap,
					ways: bitmap ? null : wayResults,
				},
				[
					nodeResults.positions.buffer,
					nodeResults.indexes.buffer,
					...(bitmap?.buffer
						? [bitmap.buffer]
						: [
								wayResults.positions.buffer,
								wayResults.indexes.buffer,
								wayResults.startIndices.buffer,
							]),
				],
			)
		} catch (e) {
			console.error(e)
			throw e
		}
	},
}

function lonLatToPixel(
	lon: number,
	lat: number,
	[minLon, minLat, maxLon, maxLat]: GeoBbox2D,
	size = 512,
): [number, number] {
	// linear interpolation
	const x = ((lon - minLon) / (maxLon - minLon)) * (size - 1)
	const y = ((maxLat - lat) / (maxLat - minLat)) * (size - 1) // y down
	return [
		Math.round(Math.max(0, Math.min(size - 1, x))),
		Math.round(Math.max(0, Math.min(size - 1, y))),
	]
}

const TILE_EPS = 1e-12

/**
 * Clip a geographic line segment [lon0,lat0]→[lon1,lat1] to the given bbox using Liang–Barsky.
 * We treat the RIGHT/TOP edges as *exclusive* (half-open box) to avoid double-drawing seams
 * between adjacent tiles. This is done by shrinking maxLon/maxLat by a tiny epsilon.
 * Returns null if the segment does not intersect the bbox.
 */
function clipSegmentToBbox(
	lon0: number,
	lat0: number,
	lon1: number,
	lat1: number,
	bbox: GeoBbox2D,
): [number, number, number, number] | null {
	let [minLon, minLat, maxLon, maxLat] = bbox
	// Make right/top edges exclusive to prevent seam lines across tiles
	maxLon -= TILE_EPS
	maxLat -= TILE_EPS

	const dx = lon1 - lon0
	const dy = lat1 - lat0

	// p and q arrays per Liang–Barsky
	const p = [-dx, dx, -dy, dy]
	const q = [lon0 - minLon, maxLon - lon0, lat0 - minLat, maxLat - lat0]

	let u1 = 0
	let u2 = 1

	for (let i = 0; i < 4; i++) {
		const pi = p[i]
		const qi = q[i]
		if (pi === 0) {
			// Segment is parallel to this boundary; reject if outside
			if (qi < 0) return null
		} else {
			const r = qi / pi
			if (pi < 0) {
				if (r > u2) return null
				if (r > u1) u1 = r
			} else {
				// pi > 0
				if (r < u1) return null
				if (r < u2) u2 = r
			}
		}
	}

	const cx0 = lon0 + u1 * dx
	const cy0 = lat0 + u1 * dy
	const cx1 = lon0 + u2 * dx
	const cy1 = lat0 + u2 * dy
	return [cx0, cy0, cx1, cy1]
}

/**
 * Rasterise OSM ways into an RGBA buffer suitable for Deck.gl BitmapLayer.
 * TODO: If this is always white, we can just set the alpha and make this "image data" 1/4th  the size.
 */
function rasterizeWaysToBitmap(
	bbox: GeoBbox2D,
	ways: {
		indexes: Uint32Array
		positions: Float64Array // [lon,lat,lon,lat,…]
		startIndices: Uint32Array
	},
	tileSize = 512,
) {
	const measure = Performance.createMeasure("rasterize ways to bitmap")
	const pxCount = tileSize * tileSize
	const data = new Uint8ClampedArray(pxCount * 4) // initialised to 0 (transparent black)

	const setPixel = (x: number, y: number) => {
		if (x < 0 || x >= tileSize || y < 0 || y >= tileSize) return
		const idx = (y * tileSize + x) * 4
		data[idx] = data[idx + 1] = data[idx + 2] = 255 // white
		data[idx + 3] = 255 // Math.min(255, data[idx + 3] + 10) // create levels of opacity
	}

	const drawLine = (x0: number, y0: number, x1: number, y1: number) => {
		const dx = Math.abs(x1 - x0)
		const dy = Math.abs(y1 - y0)
		const sx = x0 < x1 ? 1 : -1
		const sy = y0 < y1 ? 1 : -1
		let err = dx - dy
		let x = x0
		let y = y0

		while (true) {
			setPixel(x, y)
			if (x === x1 && y === y1) break
			const e2 = 2 * err
			if (e2 > -dy) {
				err -= dy
				x += sx
			}
			if (e2 < dx) {
				err += dx
				y += sy
			}
		}
	}

	// Iterate over each way
	for (let w = 0; w < ways.indexes.length; w++) {
		const start = ways.startIndices[w] * 2
		const end = ways.startIndices[w + 1] * 2

		// Each segment (clip to bbox before rasterizing to avoid edge-hugging artifacts)
		let lonPrev = ways.positions[start]
		let latPrev = ways.positions[start + 1]

		for (let p = start + 2; p < end; p += 2) {
			const lonCurr = ways.positions[p]
			const latCurr = ways.positions[p + 1]

			// Clip the geographic segment to the tile bbox using a half-open policy on top/right
			const clipped = clipSegmentToBbox(
				lonPrev,
				latPrev,
				lonCurr,
				latCurr,
				bbox,
			)
			if (clipped) {
				const [cl0lon, cl0lat, cl1lon, cl1lat] = clipped
				const [x0, y0] = lonLatToPixel(cl0lon, cl0lat, bbox, tileSize)
				const [x1, y1] = lonLatToPixel(cl1lon, cl1lat, bbox, tileSize)
				if (x0 !== x1 || y0 !== y1) {
					drawLine(x0, y0, x1, y1)
				}
			}

			lonPrev = lonCurr
			latPrev = latCurr
		}
	}
	measure()
	return data
}

export type OsmWorker = typeof osmWorker

expose(osmWorker)
