import type {
	OsmPbfBlock,
	OsmPbfDenseNodes,
	OsmPbfGroup,
	OsmPbfInfo,
	OsmPbfNode,
	OsmPbfRelation,
	OsmPbfStringTable,
	OsmPbfWay,
} from "@osmix/pbf"
import { assertValue } from "@osmix/shared/assert"
import type {
	OsmEntityType,
	OsmInfoParsed,
	OsmNode,
	OsmRelation,
	OsmRelationMember,
	OsmWay,
} from "./types"

export interface ParseOptions {
	parseTags?: boolean
	includeInfo?: boolean
}

const ENTITY_MEMBER_TYPES: OsmEntityType[] = ["node", "way", "relation"]

function decodeStringTable(stringtable: OsmPbfStringTable) {
	const decoded = new Map<number, string>()
	const textDecoder = new TextDecoder()
	for (let i = 0; i < stringtable.length; i++) {
		decoded.set(i, textDecoder.decode(stringtable[i]))
	}
	return decoded
}

/**
 * Parse a primitive block into usable entities.
 * - Dense nodes are parsed into a list of nodes
 * - Tag keys and values are parsed into a map of strings
 * - Info is parsed into a map of strings
 * - Delta encoding, offsets, and other PBF-specific encoding details are handled
 */
export class OsmPbfBlockParser implements OsmPbfBlock {
	stringtable: OsmPbfStringTable
	primitivegroup: OsmPbfGroup[] = []

	private parsedStringTable = new Map<number, string>()

	date_granularity: number
	granularity: number
	lat_offset: number
	lon_offset: number

	parseOptions: ParseOptions = {
		// Include tags as indexes in table or as parsed objects
		parseTags: true,
		includeInfo: false,
	}

	constructor(block: OsmPbfBlock, options: ParseOptions = {}) {
		this.date_granularity = block.date_granularity ?? 1_000
		this.stringtable = block.stringtable
		this.primitivegroup = block.primitivegroup
		this.granularity = block.granularity ?? 1e7
		this.lat_offset = block.lat_offset ?? 0
		this.lon_offset = block.lon_offset ?? 0
		this.parseOptions = {
			...this.parseOptions,
			...options,
		}
		this.parsedStringTable = decodeStringTable(this.stringtable)
	}

	/**
	 * Make this class iterable. Iterates over the primitive groups and yields their parsed entities.
	 */
	*[Symbol.iterator]() {
		for (const group of this.primitivegroup) {
			if (group.nodes.length > 0) {
				yield group.nodes.map((n) => this.parseNode(n, this.parseOptions))
			}
			if (group.dense != null) {
				yield this.parseDenseNodes(group.dense, this.parseOptions)
			}
			if (group.ways.length > 0) {
				yield group.ways.map((w) => this.parseWay(w, this.parseOptions))
			}
			if (group.relations.length > 0) {
				yield group.relations.map((r) =>
					this.parseRelation(r, this.parseOptions),
				)
			}
		}
	}

	fillInfo(info: OsmPbfInfo): OsmInfoParsed {
		return {
			...info,
			timestamp:
				info.timestamp === undefined || info.timestamp === 0
					? undefined
					: info.timestamp * this.date_granularity,
			user:
				info.user_sid === undefined ? undefined : this.getString(info.user_sid),
		}
	}

	private getString(index: number | undefined) {
		assertValue(index, "String index is undefined")
		const string = this.parsedStringTable.get(index)
		assertValue(string, `String missing in block at index ${index}`)
		return string
	}

	getTags(keys: number[], vals: number[]) {
		return Object.fromEntries(
			keys
				.map((_, i) => [this.getString(keys[i]), this.getString(vals[i])])
				.filter(([key, val]) => key && val),
		)
	}

	parseNode(
		n: OsmPbfNode,
		{ parseTags = true, includeInfo = false }: ParseOptions = {},
	): OsmNode {
		const node: OsmNode = {
			id: n.id,
			lon: this.lon_offset + n.lon / this.granularity,
			lat: this.lat_offset + n.lat / this.granularity,
		}
		if (parseTags) {
			node.tags = this.getTags(n.keys, n.vals)
		}
		if (includeInfo && n.info) {
			node.info = this.fillInfo(n.info)
		}
		return node
	}

	parseWay(
		w: OsmPbfWay,
		{ parseTags = true, includeInfo = false }: ParseOptions = {},
	): OsmWay {
		let ref = 0
		const way: OsmWay = {
			id: w.id,
			refs: w.refs.map((refSid) => {
				ref += refSid
				return ref
			}),
		}
		if (parseTags) {
			way.tags = this.getTags(w.keys, w.vals)
		}
		if (includeInfo && w.info) {
			way.info = this.fillInfo(w.info)
		}
		return way
	}

	parseRelation(
		r: OsmPbfRelation,
		{ parseTags = true, includeInfo = false }: ParseOptions = {},
	): OsmRelation {
		let ref = 0
		const members: OsmRelationMember[] = r.memids.map((memid, i) => {
			ref += memid

			const memberType = r.types[i]
			assertValue(memberType, "Member type is undefined")
			const type = ENTITY_MEMBER_TYPES[memberType]
			assertValue(type, "Member type is undefined")
			return {
				type,
				ref,
				role: this.getString(r.roles_sid[i]),
			}
		})

		const relation: OsmRelation = {
			id: r.id,
			members,
		}
		if (parseTags) {
			relation.tags = this.getTags(r.keys, r.vals)
		}
		if (includeInfo && r.info) {
			relation.info = this.fillInfo(r.info)
		}
		return relation
	}

	parseDenseNodes(
		dense: OsmPbfDenseNodes,
		{ parseTags = true, includeInfo = false }: ParseOptions = {},
	): OsmNode[] {
		const delta = {
			id: 0,
			lat: 0,
			lon: 0,
			timestamp: 0,
			changeset: 0,
			uid: 0,
			user_sid: 0,
		}
		let keysValsIndex = 0

		return dense.id.map((idSid, nodeIndex) => {
			delta.id += idSid

			const latSid = dense.lat[nodeIndex]
			assertValue(latSid, "Latitude is undefined")
			delta.lat += latSid

			const lonSid = dense.lon[nodeIndex]
			assertValue(lonSid, "Longitude is undefined")
			delta.lon += lonSid

			const node: OsmNode = {
				id: delta.id,
				lon: this.lon_offset + delta.lon / this.granularity,
				lat: this.lat_offset + delta.lat / this.granularity,
			}
			if (dense.keys_vals.length > 0) {
				if (parseTags) {
					node.tags = {}
					while (dense.keys_vals[keysValsIndex] !== 0) {
						const key = this.getString(dense.keys_vals[keysValsIndex])
						const val = this.getString(dense.keys_vals[keysValsIndex + 1])
						if (key && val) {
							node.tags[key] = val
						}
						keysValsIndex += 2
					}
					keysValsIndex++
				}
			}
			if (includeInfo && dense.denseinfo) {
				const iTime = dense.denseinfo.timestamp[nodeIndex]
				assertValue(iTime, "Timestamp is undefined")
				const iChangeset = dense.denseinfo.changeset[nodeIndex]
				assertValue(iChangeset, "Changeset is undefined")
				const iUid = dense.denseinfo.uid[nodeIndex]
				assertValue(iUid, "UID is undefined")
				const iUserSid = dense.denseinfo.user_sid[nodeIndex]
				assertValue(iUserSid, "User SID is undefined")
				const iVersion = dense.denseinfo.version[nodeIndex]

				delta.timestamp += iTime
				delta.changeset += iChangeset
				delta.uid += iUid
				delta.user_sid += iUserSid

				node.info = {
					version: iVersion,
					timestamp: delta.timestamp * this.date_granularity,
					changeset: delta.changeset,
					uid: delta.uid,
					user_sid: delta.user_sid,
					visible: dense.denseinfo.visible[nodeIndex],
				}
			}
			return node
		})
	}
}
