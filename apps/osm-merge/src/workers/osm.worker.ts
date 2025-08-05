import { Osm, type GeoBbox2D, type TileIndex } from "osm.ts"
import { expose, transfer } from "comlink"
import type { _TileLoadProps } from "@deck.gl/geo-layers"
import { MIN_NODE_ZOOM, MIN_PICKABLE_ZOOM } from "@/settings"

const osmWorker = {
	osm(id: string) {
		if (!this.ids[id]) throw Error("Osm not loaded.")
		return this.ids[id]
	},
	ids: {} as Record<string, Osm>,
	initFromPbfData(
		id: string,
		data: ArrayBuffer | ReadableStream<Uint8Array>,
		onProgress: (...args: string[]) => void,
	) {
		const osm = new Osm()
		this.ids[id] = osm
		return osm.initFromPbfData(data, onProgress)
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
		const nodeResults =
			tileIndex.z > MIN_NODE_ZOOM
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

/**
 * Rasterise OSM ways into an RGBA buffer suitable for Deck.gl BitmapLayer.
 */
function rasterizeWaysToBitmap(
	bbox: GeoBbox2D,
	ways: {
		indexes: Uint32Array
		positions: Float32Array // [lon,lat,lon,lat,…]
		startIndices: Uint32Array
	},
	tileSize = 512,
) {
	console.time("rasterizeWaysToBitmap")
	const pxCount = tileSize * tileSize
	const data = new Uint8ClampedArray(pxCount * 4) // initialised to 0 (transparent black)

	const setPixel = (x: number, y: number) => {
		if (x < 0 || x >= tileSize || y < 0 || y >= tileSize) return
		const idx = (y * tileSize + x) * 4
		data[idx] = data[idx + 1] = data[idx + 2] = 255 // white
		data[idx + 3] = Math.min(255, data[idx + 3] + 255 / 5) // five levels of opacity
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
		const start = ways.startIndices[w]
		const end = ways.startIndices[w + 1]
		const positions = ways.positions.slice(start * 2, end * 2)

		let [xPrev, yPrev] = lonLatToPixel(
			positions[0],
			positions[1],
			bbox,
			tileSize,
		)

		// Each segment
		for (let p = 2; p < positions.length; p += 2) {
			const [xCurr, yCurr] = lonLatToPixel(
				positions[p],
				positions[p + 1],
				bbox,
				tileSize,
			)
			if (xPrev !== xCurr || yPrev !== yCurr) {
				drawLine(xPrev, yPrev, xCurr, yCurr)
			}
			xPrev = xCurr
			yPrev = yCurr
		}
	}
	console.timeEnd("rasterizeWaysToBitmap")
	return data
}

export type OsmWorker = typeof osmWorker

expose(osmWorker)
