import type { OsmPbfBlock, OsmPbfDenseNodes } from "@osmix/pbf"
import { assertValue } from "@osmix/shared/assert"
import {
	bboxToMicroDegrees,
	microToDegrees,
	toMicroDegrees,
} from "@osmix/shared/coordinates"
import type { GeoBbox2D, OsmNode, OsmTags } from "@osmix/shared/types"
import KDBush from "kdbush"
import { Entities, type EntitiesTransferables } from "./entities"
import { type IdOrIndex, Ids } from "./ids"
import type StringTable from "./stringtable"
import { Tags } from "./tags"
import {
	BufferConstructor,
	type BufferType,
	ResizeableTypedArray as RTA,
} from "./typed-arrays"

export interface NodesTransferables extends EntitiesTransferables {
	lons: BufferType
	lats: BufferType
	bbox: GeoBbox2D
	spatialIndex: BufferType
}

export interface AddNodeOptions {
	filter?: (node: OsmNode) => boolean
}

export class Nodes extends Entities<OsmNode> {
	/**
	 * Coordinates are stored as integer microdegrees (Int32Array).
	 * Use OSM_COORD_SCALE (1e7) to convert between degrees and microdegrees.
	 */
	private lons: RTA<Int32Array>
	private lats: RTA<Int32Array>
	// Bbox stored in microdegrees internally
	private bbox: [
		minLon: number,
		minLat: number,
		maxLon: number,
		maxLat: number,
	] = [
		Number.MAX_SAFE_INTEGER,
		Number.MAX_SAFE_INTEGER,
		Number.MIN_SAFE_INTEGER,
		Number.MIN_SAFE_INTEGER,
	]
	private spatialIndex: KDBush = new KDBush(
		0,
		128,
		Int32Array,
		BufferConstructor,
	)

	/**
	 * Create a new Nodes index.
	 */
	constructor(stringTable: StringTable, transferables?: NodesTransferables) {
		if (transferables) {
			super(
				"node",
				new Ids(transferables),
				new Tags(stringTable, transferables),
			)
			this.lons = RTA.from(Int32Array, transferables.lons)
			this.lats = RTA.from(Int32Array, transferables.lats)
			this.spatialIndex = KDBush.from(transferables.spatialIndex)
			// Convert bbox from degrees to microdegrees
			this.bbox = bboxToMicroDegrees(transferables.bbox)
			this.indexBuilt = true
		} else {
			super("node", new Ids(), new Tags(stringTable))
			this.lons = new RTA(Int32Array)
			this.lats = new RTA(Int32Array)
			this.spatialIndex = new KDBush(0, 128, Int32Array, BufferConstructor)
		}
	}

	/**
	 * Add a single node to the index.
	 */
	addNode(node: OsmNode): number {
		const nodeIndex = this.addEntity(node.id, node.tags ?? {})

		const lonMicro = toMicroDegrees(node.lon)
		const latMicro = toMicroDegrees(node.lat)

		this.lons.push(lonMicro)
		this.lats.push(latMicro)

		if (node.lon < this.bbox[0]) this.bbox[0] = node.lon
		if (node.lat < this.bbox[1]) this.bbox[1] = node.lat
		if (node.lon > this.bbox[2]) this.bbox[2] = node.lon
		if (node.lat > this.bbox[3]) this.bbox[3] = node.lat

		return nodeIndex
	}

	/**
	 * Add dense nodes from a PBF block.
	 */
	addDenseNodes(
		dense: OsmPbfDenseNodes,
		block: OsmPbfBlock,
		blockStringIndexMap: Uint32Array,
		filter?: (node: OsmNode) => boolean,
	): number {
		// PBF block already has offsets and granularity converted to degrees
		const lon_offset = block.lon_offset ?? 0
		const lat_offset = block.lat_offset ?? 0
		const granularity = block.granularity ?? 1e7

		const delta = {
			id: 0,
			lat: 0,
			lon: 0,
			timestamp: 0,
			changeset: 0,
			uid: 0,
			user_sid: 0,
		}

		const getStringTableIndex = (keyIndex: number) => {
			const key = dense.keys_vals[keyIndex]
			assertValue(key, "Block string key is undefined")
			const index = blockStringIndexMap[key]
			assertValue(index, "Block string not found")
			return index
		}

		let keysValsIndex = 0
		let added = 0
		for (let i = 0; i < dense.id.length; i++) {
			const idSid = dense.id[i]
			const latSid = dense.lat[i]
			const lonSid = dense.lon[i]
			assertValue(idSid, "ID SID is undefined")
			assertValue(latSid, "Latitude SID is undefined")
			assertValue(lonSid, "Longitude SID is undefined")

			delta.id += idSid
			delta.lat += latSid
			delta.lon += lonSid

			// Calculate degrees from PBF delta encoding
			const lon = lon_offset + delta.lon / granularity
			const lat = lat_offset + delta.lat / granularity

			// Convert to microdegrees for storage
			const lonMicro = toMicroDegrees(lon)
			const latMicro = toMicroDegrees(lat)

			const tagKeys: number[] = []
			const tagValues: number[] = []
			if (dense.keys_vals.length > 0) {
				while (dense.keys_vals[keysValsIndex] !== 0) {
					const key = getStringTableIndex(keysValsIndex)
					const val = getStringTableIndex(keysValsIndex + 1)
					if (key && val) {
						tagKeys.push(key)
						tagValues.push(val)
					}
					keysValsIndex += 2
				}
				keysValsIndex++
			}

			const shouldInclude = filter
				? filter({
						id: delta.id,
						lon,
						lat,
						tags: this.tags.getTagsFromIndices(tagKeys, tagValues),
					})
				: true
			if (!shouldInclude) continue

			this.addEntity(delta.id, tagKeys, tagValues)
			this.lons.push(lonMicro)
			this.lats.push(latMicro)

			if (lon < this.bbox[0]) this.bbox[0] = lon
			if (lat < this.bbox[1]) this.bbox[1] = lat
			if (lon > this.bbox[2]) this.bbox[2] = lon
			if (lat > this.bbox[3]) this.bbox[3] = lat
			added++
		}

		return added
	}

	/**
	 * Compact the internal arrays to free up memory.
	 */
	buildEntityIndex() {
		this.lons.compact()
		this.lats.compact()
	}

	/**
	 * Build the spatial index for nodes.
	 */
	buildSpatialIndex() {
		console.time("NodeIndex.buildSpatialIndex")
		this.spatialIndex = new KDBush(this.size, 64, Int32Array, BufferConstructor)
		for (let i = 0; i < this.size; i++) {
			// Store microdegrees directly in spatial index
			this.spatialIndex.add(this.lons.at(i), this.lats.at(i))
		}
		this.spatialIndex.finish()
		console.timeEnd("NodeIndex.buildSpatialIndex")
	}

	/**
	 * Get the bounding box of all nodes.
	 */
	getBbox(): GeoBbox2D {
		return this.bbox
	}

	/**
	 * Get the bounding box of a specific node.
	 */
	getEntityBbox(i: IdOrIndex): GeoBbox2D {
		const index = "index" in i ? i.index : this.ids.idOrIndex(i)[0]
		const lon = microToDegrees(this.lons.at(index))
		const lat = microToDegrees(this.lats.at(index))
		return [lon, lat, lon, lat] as GeoBbox2D
	}

	/**
	 * Get the longitude and latitude of a specific node.
	 */
	getNodeLonLat(i: IdOrIndex): [number, number] {
		const index = "index" in i ? i.index : this.ids.idOrIndex(i)[0]
		return [
			microToDegrees(this.lons.at(index)),
			microToDegrees(this.lats.at(index)),
		]
	}

	/**
	 * Get the full node entity.
	 */
	getFullEntity(index: number, id: number, tags?: OsmTags): OsmNode {
		const [lon, lat] = this.getNodeLonLat({ index })
		if (tags) {
			return {
				id,
				lat,
				lon,
				tags,
			}
		}
		return {
			id,
			lat,
			lon,
		}
	}

	// Spatial operations
	/**
	 * Find node indexes within a bounding box.
	 */
	findIndexesWithinBbox(bbox: GeoBbox2D): number[] {
		// Convert bbox from degrees to microdegrees for spatial index query
		const bboxMicro = bboxToMicroDegrees(bbox)
		return this.spatialIndex.range(
			bboxMicro[0],
			bboxMicro[1],
			bboxMicro[2],
			bboxMicro[3],
		)
	}

	/**
	 * Find node indexes within a radius of a point.
	 */
	findIndexesWithinRadius(x: number, y: number, radius: number): number[] {
		// Convert coordinates and radius from degrees to microdegrees
		const xMicro = toMicroDegrees(x)
		const yMicro = toMicroDegrees(y)
		// Radius in degrees needs to be converted to microdegrees
		const radiusMicro = toMicroDegrees(radius)
		return this.spatialIndex.within(xMicro, yMicro, radiusMicro)
	}

	/**
	 * Get nodes within a bounding box.
	 * @param bbox - The bounding box to search within.
	 * @param include - A function to filter nodes. If provided, only nodes for which the function returns true will be included.
	 * @returns An object containing the IDs and positions of the nodes within the bounding box.
	 */
	withinBbox(
		bbox: GeoBbox2D,
		include?: (i: number) => boolean,
	): {
		ids: Float64Array
		positions: Float64Array
	} {
		console.time("Nodes.withinBbox")
		const nodeCandidates = this.findIndexesWithinBbox(bbox)
		const nodePositions = new Float64Array(nodeCandidates.length * 2)
		const ids = new Float64Array(nodeCandidates.length)

		let skipped = 0
		nodeCandidates.forEach((nodeIndex, i) => {
			if (include && !include(nodeIndex)) {
				skipped++
				return
			}

			const [lon, lat] = this.getNodeLonLat({ index: nodeIndex })
			ids[i - skipped] = this.ids.at(nodeIndex)
			nodePositions[(i - skipped) * 2] = lon
			nodePositions[(i - skipped) * 2 + 1] = lat
		})
		console.timeEnd("Nodes.withinBbox")
		return {
			ids: ids.subarray(0, nodeCandidates.length - skipped),
			positions: nodePositions.slice(0, (nodeCandidates.length - skipped) * 2),
		}
	}

	/**
	 * Get transferable objects for passing to another thread.
	 */
	override transferables(): NodesTransferables {
		return {
			...super.transferables(),
			lons: this.lons.array.buffer,
			lats: this.lats.array.buffer,
			bbox: this.bbox,
			spatialIndex: this.spatialIndex.data,
		}
	}
}
