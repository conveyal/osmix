import {
	MAX_ENTITIES_PER_BLOCK,
	type OsmPbfBlock,
	type OsmPbfBlockSettings,
	type OsmPbfGroup,
	type OsmPbfInfo,
	type OsmPbfStringTable,
} from "@osmix/pbf"
import { OSM_ENTITY_TYPES } from "./constants"
import type {
	OsmInfoParsed,
	OsmNode,
	OsmRelation,
	OsmTags,
	OsmWay,
} from "./types"

/**
 * Build a primitive block from parsed OSM entities. Handles delta encoding, stringtable, and other PBF-specific encoding details.
 */
export class OsmPbfBlockBuilder implements OsmPbfBlock {
	stringtable: OsmPbfStringTable = []
	private stringToIndex = new Map<string, number>()
	private encoder = new TextEncoder()

	// For simplicity, only one group is allowed in a block
	primitivegroup: OsmPbfGroup[] = [
		{
			dense: undefined,
			nodes: [],
			ways: [],
			relations: [],
		},
	] as const
	readonly group: OsmPbfGroup = this.primitivegroup[0] as OsmPbfGroup

	date_granularity: number
	granularity: number
	lat_offset: number
	lon_offset: number

	private includeInfo: boolean
	private maxEntitiesPerBlock: number

	constructor(
		blockSettings?: OsmPbfBlockSettings & {
			includeInfo?: boolean
			maxEntitiesPerBlock?: number
		},
	) {
		this.date_granularity = blockSettings?.date_granularity ?? 1_000
		this.granularity = blockSettings?.granularity ?? 1e7
		this.lat_offset = blockSettings?.lat_offset ?? 0
		this.lon_offset = blockSettings?.lon_offset ?? 0
		this.includeInfo = blockSettings?.includeInfo ?? false
		this.maxEntitiesPerBlock =
			blockSettings?.maxEntitiesPerBlock ?? MAX_ENTITIES_PER_BLOCK

		// Initialize the string table with an empty string
		this.getStringtableIndex("")
	}

	totalEntities() {
		return (
			this.group.nodes.length +
			this.group.ways.length +
			this.group.relations.length +
			(this.group.dense?.id.length ?? 0)
		)
	}

	isEmpty() {
		return this.totalEntities() === 0
	}

	isFull() {
		return this.totalEntities() >= this.maxEntitiesPerBlock
	}

	getStringtableIndex(key: string): number {
		const existingIndex = this.stringToIndex.get(key)
		if (existingIndex !== undefined) return existingIndex
		const index = this.stringtable.length
		const encoded = this.encoder.encode(key)
		this.stringtable.push(encoded)
		this.stringToIndex.set(key, index)
		return index
	}

	addTags(tags: OsmTags) {
		const keys = []
		const vals = []
		for (const [key, val] of Object.entries(tags)) {
			keys.push(this.getStringtableIndex(key))
			vals.push(this.getStringtableIndex(val.toString()))
		}
		return { keys, vals }
	}

	addInfo(info: OsmInfoParsed): OsmPbfInfo {
		return {
			...info,
			timestamp: Math.floor(info.timestamp ?? 0 / this.date_granularity),
			user_sid: this.getStringtableIndex(info.user ?? ""),
		}
	}

	addNode(node: OsmNode) {
		const tags = this.addTags(node.tags ?? {})
		const info = this.includeInfo ? this.addInfo(node.info ?? {}) : undefined
		this.group.nodes.push({
			id: node.id,
			lat: Math.round((node.lat - this.lat_offset) * this.granularity),
			lon: Math.round((node.lon - this.lon_offset) * this.granularity),
			keys: tags.keys,
			vals: tags.vals,
			info,
		})
	}

	addWay(way: OsmWay) {
		const tags = this.addTags(way.tags ?? {})
		const info = this.includeInfo ? this.addInfo(way.info ?? {}) : undefined
		let lastRef = 0
		const refs = way.refs.map((ref) => {
			const delta = ref - lastRef
			lastRef = ref
			return delta
		})
		this.group.ways.push({
			id: way.id,
			refs,
			keys: tags.keys,
			vals: tags.vals,
			info,
		})
	}

	addRelation(relation: OsmRelation) {
		const tags = this.addTags(relation.tags ?? {})
		const info = this.includeInfo
			? this.addInfo(relation.info ?? {})
			: undefined
		const memids: number[] = []
		const roles_sid: number[] = []
		const types: number[] = []

		// Delta code the memids
		let lastMemId = 0
		for (const member of relation.members) {
			memids.push(member.ref - lastMemId)
			lastMemId = member.ref
			roles_sid.push(this.getStringtableIndex(member.role ?? ""))
			types.push(OSM_ENTITY_TYPES.indexOf(member.type))
		}
		this.group.relations.push({
			id: relation.id,
			keys: tags.keys,
			vals: tags.vals,
			info,
			memids,
			roles_sid,
			types,
		})
	}

	// Delta encoding state for dense nodes
	private delta = {
		id: 0,
		lat: 0,
		lon: 0,
		timestamp: 0,
		changeset: 0,
		uid: 0,
		user_sid: 0,
	}

	private initializeDenseNodes() {
		this.group.dense = {
			id: [],
			lat: [],
			lon: [],
			keys_vals: [],
			denseinfo: this.includeInfo
				? {
						version: [],
						timestamp: [],
						changeset: [],
						uid: [],
						user_sid: [],
						visible: [],
					}
				: undefined,
		}
		return this.group.dense
	}

	addDenseNode(node: OsmNode) {
		const { id, lat, lon, keys_vals, denseinfo } = this.group.dense
			? this.group.dense
			: this.initializeDenseNodes()
		// Delta encode id
		id.push(node.id - this.delta.id)
		this.delta.id = node.id

		// Delta encode lat/lon
		const encLat = Math.round((node.lat - this.lat_offset) * this.granularity)
		const encLon = Math.round((node.lon - this.lon_offset) * this.granularity)
		lat.push(encLat - this.delta.lat)
		lon.push(encLon - this.delta.lon)
		this.delta.lat = encLat
		this.delta.lon = encLon

		// Encode tags as key/value index pairs, terminated by 0
		if (node.tags && Object.keys(node.tags).length > 0) {
			for (const [key, val] of Object.entries(node.tags)) {
				keys_vals.push(this.getStringtableIndex(key))
				keys_vals.push(this.getStringtableIndex(val.toString()))
			}
		}
		keys_vals.push(0)

		// Encode info if present
		if (denseinfo) {
			const { version, timestamp, changeset, uid, user_sid, visible } =
				denseinfo
			// Version is not delta encoded
			version.push(node.info?.version ?? 0)
			// Delta encode timestamp, changeset, uid, user_sid
			const t = Math.floor((node.info?.timestamp ?? 0) / this.date_granularity)
			timestamp.push(t - this.delta.timestamp)
			this.delta.timestamp = t
			changeset.push((node.info?.changeset ?? 0) - this.delta.changeset)
			this.delta.changeset = node.info?.changeset ?? 0
			uid.push((node.info?.uid ?? 0) - this.delta.uid)
			this.delta.uid = node.info?.uid ?? 0
			user_sid.push((node.info?.user_sid ?? 0) - this.delta.user_sid)
			this.delta.user_sid = node.info?.user_sid ?? 0
			visible.push(node.info?.visible ?? true)
		}
	}
}
