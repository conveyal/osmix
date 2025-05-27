import type {
	OsmPbfDenseNodes,
	OsmPbfInfo,
	OsmPbfNode,
	OsmPbfPrimitiveBlock,
	OsmPbfPrimitiveGroup,
	OsmPbfRelation,
	OsmPbfWay,
} from "./proto/osmformat"
import type {
	OsmNode,
	OsmPbfInfoParsed,
	OsmRelation,
	OsmRelationMember,
	OsmWay,
} from "./types"
import { assertNonNull } from "./utils"

export const MEMBER_TYPES = ["node", "way", "relation"]
export const MAX_ENTITIES_PER_BLOCK = 8_000

class PrimitiveGroup implements OsmPbfPrimitiveGroup {
	dense?: OsmPbfDenseNodes
	nodes: OsmPbfNode[] = []
	ways: OsmPbfWay[] = []
	relations: OsmPbfRelation[] = []
}

export class OsmPrimitiveBlock implements OsmPbfPrimitiveBlock {
	stringtable: string[] = [""]
	primitivegroup: OsmPbfPrimitiveGroup[] = []

	date_granularity?: number | undefined
	granularity?: number | undefined
	lat_offset?: number | undefined
	lon_offset?: number | undefined

	#entities = 0

	constructor(block?: OsmPbfPrimitiveBlock) {
		if (block) {
			this.date_granularity = block.date_granularity
			this.stringtable = block.stringtable
			this.primitivegroup = block.primitivegroup
			this.granularity = block.granularity
			this.lat_offset = block.lat_offset
			this.lon_offset = block.lon_offset
		} else {
			this.addGroup()
		}
	}

	*[Symbol.iterator]() {
		for (const group of this.primitivegroup) {
			if (group.nodes) {
				yield group.nodes.map((n) => this.parseNode(n))
			}
			if (group.dense) {
				yield this.parseDenseNodes(group.dense)
			}
			for (const w of group.ways) {
				yield this.parseWay(w)
			}
			for (const r of group.relations) {
				yield this.parseRelation(r)
			}
		}
	}

	fillInfo(info: OsmPbfInfo | undefined): OsmPbfInfoParsed | undefined {
		if (!info) return undefined
		return {
			...info,
			timestamp:
				info.timestamp === undefined || info.timestamp === 0
					? undefined
					: info.timestamp * (this.date_granularity ?? 1000),
			user:
				info.user_sid === undefined || this.stringtable[info.user_sid]
					? undefined
					: this.stringtable[info.user_sid],
		}
	}

	getString(keys: number[], index: number) {
		const key = keys[index]
		if (key === undefined) return undefined
		return this.stringtable[key]
	}

	getTags(keys: number[], vals: number[]) {
		return Object.fromEntries(
			keys
				.map((_, i) => [this.getString(keys, i), this.getString(vals, i)])
				.filter(([key, val]) => key && val),
		)
	}

	addGroup() {
		this.primitivegroup.push(new PrimitiveGroup())
	}

	isFull() {
		return this.#entities >= MAX_ENTITIES_PER_BLOCK
	}

	get group() {
		const g = this.primitivegroup[this.primitivegroup.length - 1]
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

	addTags(tags: Record<string, string>) {
		const keys = []
		const vals = []
		for (const [key, val] of Object.entries(tags)) {
			keys.push(this.getStringtableIndex(key))
			vals.push(this.getStringtableIndex(val))
		}
		return { keys, vals }
	}

	addNode(node: OsmNode) {
		const tags = this.addTags(node.tags ?? {})
		this.group.nodes.push({
			...node,
			keys: tags.keys,
			vals: tags.vals,
		})
		this.#entities++
	}

	parseNode(n: OsmPbfNode): OsmNode {
		return {
			id: n.id,
			type: "node",
			lon: (this.lon_offset ?? 0) + n.lon / (this.granularity ?? 1e7),
			lat: (this.lat_offset ?? 0) + n.lat / (this.granularity ?? 1e7),
			tags: this.getTags(n.keys, n.vals),
			info: this.fillInfo(n.info),
		}
	}

	addWay(way: OsmWay) {
		let lastRef = 0
		const refs = way.refs.map((ref) => {
			const delta = ref - lastRef
			lastRef = ref
			return delta
		})
		const tags = this.addTags(way.tags ?? {})
		this.group.ways.push({
			...way,
			refs,
			keys: tags.keys,
			vals: tags.vals,
		})
		this.#entities++
	}

	parseWay(w: OsmPbfWay): OsmWay {
		let ref = 0
		return {
			id: w.id,
			type: "way",
			refs: w.refs.map((refSid) => {
				ref += refSid
				return ref
			}),
			tags: this.getTags(w.keys, w.vals),
			info: this.fillInfo(w.info),
		}
	}

	addRelation(relation: OsmRelation) {
		const memids: number[] = []
		const roles_sid: number[] = []
		const types: number[] = []

		// Delta code the memids
		let lastMemId = 0
		for (const member of relation.members) {
			memids.push(member.ref - lastMemId)
			lastMemId = member.ref
			roles_sid.push(this.getStringtableIndex(member.role ?? ""))
			types.push(MEMBER_TYPES.indexOf(member.type))
		}

		const tags = this.addTags(relation.tags ?? {})
		this.group.relations.push({
			...relation,
			keys: tags.keys,
			vals: tags.vals,
			memids,
			roles_sid,
			types,
		})
	}

	parseRelation(r: OsmPbfRelation): OsmRelation {
		let ref = 0
		const members: OsmRelationMember[] = r.memids.map((memid, i) => {
			ref += memid

			const memberType = r.types[i]
			assertNonNull(memberType)
			const type = MEMBER_TYPES[memberType]
			assertNonNull(type)
			return {
				type,
				ref,
				role: this.getString(r.roles_sid, i),
			}
		})

		return {
			id: r.id,
			type: "relation",
			tags: this.getTags(r.keys, r.vals),
			info: this.fillInfo(r.info),
			members,
		}
	}

	addDenseNode(node: OsmNode) {
		const tags = this.addTags(node.tags ?? {})
	}

	parseDenseNodes(dense: OsmPbfDenseNodes): OsmNode[] {
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

		const granularity = this.granularity ?? 1e7
		const latOffset = this.lat_offset ?? 0
		const lonOffset = this.lon_offset ?? 0
		const dateGranularity = this.date_granularity ?? 1000

		return dense.id.map((idSid, nodeIndex) => {
			delta.id += idSid

			const latSid = dense.lat[nodeIndex]
			assertNonNull(latSid)
			delta.lat += latSid

			const lonSid = dense.lon[nodeIndex]
			assertNonNull(lonSid)
			delta.lon += lonSid

			const node: OsmNode = {
				id: delta.id,
				type: "node",
				lon: lonOffset + delta.lon / granularity,
				lat: latOffset + delta.lat / granularity,
			}
			if (dense.keys_vals.length > 0) {
				node.tags = {}
				while (dense.keys_vals[keysValsIndex] !== 0) {
					const key = this.getString(dense.keys_vals, keysValsIndex)
					const val = this.getString(dense.keys_vals, keysValsIndex + 1)
					if (key && val) {
						node.tags[key] = val
					}
					keysValsIndex += 2
				}
				keysValsIndex++
			}
			if (dense.denseinfo) {
				const iTime = dense.denseinfo.timestamp[nodeIndex]
				const iChangeset = dense.denseinfo.changeset[nodeIndex]
				const iUid = dense.denseinfo.uid[nodeIndex]
				const iUserSid = dense.denseinfo.user_sid[nodeIndex]
				const iVersion = dense.denseinfo.version[nodeIndex]
				assertNonNull(iTime)
				assertNonNull(iChangeset)
				assertNonNull(iUid)
				assertNonNull(iUserSid)
				assertNonNull(iVersion)

				delta.timestamp += iTime
				delta.changeset += iChangeset
				delta.uid += iUid
				delta.user_sid += iUserSid

				node.info = {
					version: iVersion,
					timestamp: delta.timestamp * dateGranularity,
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
