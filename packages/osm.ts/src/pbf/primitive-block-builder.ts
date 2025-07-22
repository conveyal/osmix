import type { OsmNode, OsmRelation, OsmTags, OsmWay } from "../types"
import { isNode, isRelation, isWay } from "../utils"
import { MEMBER_TYPES } from "./primitive-block-parser"
import type {
	OsmPbfBlockSettings,
	OsmPbfNode,
	OsmPbfPrimitiveBlock,
	OsmPbfPrimitiveGroup,
} from "./proto/osmformat"

export const MAX_ENTITIES_PER_BLOCK = 8_000

export class PrimitiveBlockBuilder implements OsmPbfPrimitiveBlock {
	stringtable: string[] = [""]

	// Only one group is allowed in a block
	primitivegroup: OsmPbfPrimitiveGroup[] = [
		{
			dense: undefined,
			nodes: [],
			ways: [],
			relations: [],
		},
	]

	date_granularity = 1_000
	granularity = 1e7
	lat_offset = 0
	lon_offset = 0

	#entities = 0
	#includeInfo = false

	constructor(blockSettings: OsmPbfBlockSettings = {}) {
		this.date_granularity = blockSettings.date_granularity ?? 1_000
		this.granularity = blockSettings.granularity ?? 1e7
		this.lat_offset = blockSettings.lat_offset ?? 0
		this.lon_offset = blockSettings.lon_offset ?? 0
	}

	getString(keys: number[], index: number) {
		const key = keys[index]
		if (key === undefined) return undefined
		return this.stringtable[key]
	}

	isEmpty() {
		return this.#entities === 0
	}

	isFull() {
		return this.#entities >= MAX_ENTITIES_PER_BLOCK
	}

	get group() {
		const g = this.primitivegroup[0]
		if (g == null) throw new Error("No group found")
		return g
	}

	getStringtableIndex(key: string) {
		let index = this.stringtable.findIndex((t) => t === key)
		if (index === -1) {
			this.stringtable.push(key)
			index = this.stringtable.length - 1
		}
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

	addEntity(entity: OsmNode | OsmWay | OsmRelation) {
		const tags = this.addTags(entity.tags ?? {})
		if (isNode(entity)) {
			const node: OsmPbfNode = {
				id: entity.id,
				lat: Math.round((entity.lat - this.lat_offset) * this.granularity),
				lon: Math.round((entity.lon - this.lon_offset) * this.granularity),
				keys: tags.keys,
				vals: tags.vals,
			}
			this.group.nodes.push(node)
		} else if (isWay(entity)) {
			let lastRef = 0
			const refs = entity.refs.map((ref) => {
				const delta = ref - lastRef
				lastRef = ref
				return delta
			})
			this.group.ways.push({
				...entity,
				refs,
				keys: tags.keys,
				vals: tags.vals,
			})
		} else if (isRelation(entity)) {
			const memids: number[] = []
			const roles_sid: number[] = []
			const types: number[] = []

			// Delta code the memids
			let lastMemId = 0
			for (const member of entity.members) {
				memids.push(member.ref - lastMemId)
				lastMemId = member.ref
				roles_sid.push(this.getStringtableIndex(member.role ?? ""))
				types.push(MEMBER_TYPES.indexOf(member.type))
			}

			this.group.relations.push({
				...entity,
				keys: tags.keys,
				vals: tags.vals,
				memids,
				roles_sid,
				types,
			})
		} else {
			throw new Error("Unknown entity type")
		}
		this.#entities++
	}

	/**
	 * Convert an array of nodes into a dense nodes object, using the delta code technique in reverse from the parser.
	 * @param nodes
	 * @returns A dense nodes object that can be written to a PBF file.
	 */
	addDenseNodes(nodes: OsmNode[]) {
		if (nodes.length > MAX_ENTITIES_PER_BLOCK - this.#entities) {
			throw Error(`${nodes.length} dense nodes exceeds max block size.`)
		}
		this.#entities += nodes.length

		// Initialize dense nodes
		this.group.dense = {
			id: [],
			lat: [],
			lon: [],
			keys_vals: [],
		}
		const { id, lat, lon, keys_vals } = this.group.dense

		// For denseinfo
		const version: number[] = []
		const timestamp: number[] = []
		const changeset: number[] = []
		const uid: number[] = []
		const user_sid: number[] = []
		const visible: boolean[] = []

		// Delta state
		let lastId = 0
		let lastLat = 0
		let lastLon = 0
		let lastTimestamp = 0
		let lastChangeset = 0
		let lastUid = 0
		let lastUserSid = 0

		for (const node of nodes) {
			// Delta encode id
			id.push(node.id - lastId)
			lastId = node.id

			// Delta encode lat/lon
			const encLat = Math.round((node.lat - this.lat_offset) * this.granularity)
			const encLon = Math.round((node.lon - this.lon_offset) * this.granularity)
			lat.push(encLat - lastLat)
			lon.push(encLon - lastLon)
			lastLat = encLat
			lastLon = encLon

			// Encode tags as key/value index pairs, terminated by 0
			if (node.tags && Object.keys(node.tags).length > 0) {
				for (const [key, val] of Object.entries(node.tags)) {
					keys_vals.push(this.getStringtableIndex(key))
					keys_vals.push(this.getStringtableIndex(val.toString()))
				}
			}
			keys_vals.push(0)

			// Encode info if present and #includeInfo is true
			if (this.#includeInfo && node.info) {
				// Version is not delta encoded
				version.push(node.info.version ?? 0)
				// Delta encode timestamp, changeset, uid, user_sid
				const t = Math.floor((node.info.timestamp ?? 0) / this.date_granularity)
				timestamp.push(t - lastTimestamp)
				lastTimestamp = t
				changeset.push((node.info.changeset ?? 0) - lastChangeset)
				lastChangeset = node.info.changeset ?? 0
				uid.push((node.info.uid ?? 0) - lastUid)
				lastUid = node.info.uid ?? 0
				user_sid.push((node.info.user_sid ?? 0) - lastUserSid)
				lastUserSid = node.info.user_sid ?? 0
				visible.push(node.info.visible ?? true)
			}
		}

		if (this.#includeInfo) {
			this.group.dense.denseinfo = {
				version,
				timestamp,
				changeset,
				uid,
				user_sid,
				visible,
			}
		}
	}
}
