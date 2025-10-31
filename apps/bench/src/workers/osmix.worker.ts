import { Osmix } from "@osmix/core"
import type { OsmNode, OsmWay } from "@osmix/json"
import { type OsmPbfHeaderBlock, readOsmPbf } from "@osmix/pbf"
import { haversineDistance } from "@osmix/shared/haversine-distance"
import type { GeoBbox2D } from "@osmix/shared/types"
import { OsmixVtEncoder } from "@osmix/vt"
import { expose, wrap } from "comlink"

export class OsmixBenchWorker {
	private osm: Osmix | null = null

	async loadFromPbf(data: ArrayBuffer): Promise<void> {
		this.osm = await Osmix.fromPbf(new Uint8Array(data), {
			id: "benchmark",
			logger: console.log,
		})
	}

	async buildSpatialIndexes(): Promise<void> {
		if (!this.osm) throw new Error("OSM not loaded")
		this.osm.buildSpatialIndexes()
	}

	async getHeader(data: ArrayBuffer): Promise<OsmPbfHeaderBlock> {
		const { header } = await readOsmPbf(new Uint8Array(data))
		return header
	}

	async queryBbox(
		bbox: GeoBbox2D,
		includeTags = false,
	): Promise<{
		nodes: OsmNode[]
		ways: OsmWay[]
	}> {
		if (!this.osm) throw new Error("OSM not loaded")

		const nodeResults = this.osm.getNodesInBbox(bbox, true)
		const wayResults = this.osm.getWaysInBbox(bbox)

		const nodes: OsmNode[] = []
		for (let i = 0; i < nodeResults.ids.length; i++) {
			const id = nodeResults.ids[i]
			if (!id) continue
			const lon = nodeResults.positions[i * 2]
			const lat = nodeResults.positions[i * 2 + 1]
			if (lon === undefined || lat === undefined) continue
			if (includeTags) {
				const node = this.osm.nodes.getById(id)
				nodes.push({ id, lon, lat, tags: node?.tags ?? undefined })
			} else {
				nodes.push({ id, lon, lat })
			}
		}

		const ways: OsmWay[] = []
		for (let i = 0; i < wayResults.ids.length; i++) {
			const id = wayResults.ids[i]
			if (!id) continue
			if (includeTags) {
				const way = this.osm.ways.getById(id)
				ways.push({ id, refs: way?.refs ?? [], tags: way?.tags ?? undefined })
			} else {
				ways.push({ id, refs: [] })
			}
		}

		return { nodes, ways }
	}

	async nearestNeighbor(
		lon: number,
		lat: number,
		count: number,
	): Promise<OsmNode[]> {
		if (!this.osm) throw new Error("OSM not loaded")

		// Use withinRadius with a reasonable search radius
		const candidates = this.osm.nodes.withinRadius(lon, lat, 0.1)

		// Calculate distances and sort
		const nodesWithDistance: Array<{
			nodeIndex: number
			id: number
			lon: number
			lat: number
			distance: number
		}> = []

		for (const nodeIndex of candidates) {
			const id = this.osm.nodes.ids.at(nodeIndex)
			const [nodeLon, nodeLat] = this.osm.nodes.getNodeLonLat({
				index: nodeIndex,
			})
			const distance = haversineDistance([lon, lat], [nodeLon, nodeLat])
			nodesWithDistance.push({
				nodeIndex,
				id,
				lon: nodeLon,
				lat: nodeLat,
				distance,
			})
		}

		// Sort by distance and take top N
		nodesWithDistance.sort((a, b) => a.distance - b.distance)

		return nodesWithDistance.slice(0, count).map((n) => ({
			id: n.id,
			lon: n.lon,
			lat: n.lat,
		}))
	}

	async generateVectorTile(bbox: GeoBbox2D): Promise<Uint8Array> {
		if (!this.osm) throw new Error("OSM not loaded")

		// Encode a single-tile VT using bbox-projected coordinates
		const encoder = new OsmixVtEncoder(this.osm)
		const [minLon, minLat, maxLon, maxLat] = bbox
		const extent = 4096
		const proj = ([lon, lat]: [number, number]) => {
			const x = ((lon - minLon) / (maxLon - minLon)) * extent
			const y = ((maxLat - lat) / (maxLat - minLat)) * extent
			return [x, y] as [number, number]
		}
		const pbf = encoder.getTileForBbox(bbox, proj)
		return new Uint8Array(pbf)
	}

	async exportWaysGeoJSON(
		limit = Number.POSITIVE_INFINITY,
	): Promise<GeoJSON.FeatureCollection> {
		if (!this.osm) throw new Error("OSM not loaded")

		const features: ReturnType<typeof this.osm.getEntityGeoJson>[] = []

		for (const node of this.osm.nodes) {
			if (!node.tags || Object.keys(node.tags).length === 0) continue
			features.push(this.osm.getEntityGeoJson(node))
		}

		for (const way of this.osm.ways) {
			if (features.length >= limit) break
			features.push(this.osm.getEntityGeoJson(way))
		}

		return {
			type: "FeatureCollection",
			features,
		}
	}

	getStats(): {
		nodes: number
		ways: number
		relations: number
		bbox: [number, number, number, number]
	} | null {
		if (!this.osm) return null
		return {
			nodes: this.osm.nodes.size,
			ways: this.osm.ways.size,
			relations: this.osm.relations.size,
			bbox: this.osm.bbox(),
		}
	}
}

const isWorker = "importScripts" in globalThis
if (isWorker) {
	expose(new OsmixBenchWorker())
}

export function createWorker() {
	const worker = new Worker(new URL("./osmix.worker.ts", import.meta.url), {
		type: "module",
	})
	return wrap<OsmixBenchWorker>(worker)
}
