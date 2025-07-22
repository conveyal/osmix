import type {
	OsmNode,
	OsmInfoParsed,
	OsmRelation,
	OsmRelationMember,
	OsmTags,
	OsmWay,
} from "../types"
import type {
	OsmPbfDenseNodes,
	OsmPbfInfo,
	OsmPbfNode,
	OsmPbfPrimitiveBlock,
	OsmPbfPrimitiveGroup,
	OsmPbfRelation,
	OsmPbfWay,
} from "./proto/osmformat"

export const MEMBER_TYPES = ["node", "way", "relation"]

export class PrimitiveBlockParser implements OsmPbfPrimitiveBlock {
	stringtable: string[] = [""]
	primitivegroup: OsmPbfPrimitiveGroup[] = []

	date_granularity = 1_000
	granularity = 1e7
	lat_offset = 0
	lon_offset = 0

	#includeInfo = false

	constructor(block: OsmPbfPrimitiveBlock) {
		this.date_granularity = block.date_granularity ?? 1_000
		this.stringtable = block.stringtable
		this.primitivegroup = block.primitivegroup
		this.granularity = block.granularity ?? 1e7
		this.lat_offset = block.lat_offset ?? 0
		this.lon_offset = block.lon_offset ?? 0
	}

	/**
	 * Make this class iterable. Iterates over the primitive groups and yields their parsed entities.
	 */
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

	fillInfo(info: OsmPbfInfo | undefined): OsmInfoParsed | undefined {
		if (!this.#includeInfo || !info) return undefined
		return {
			...info,
			timestamp:
				info.timestamp === undefined || info.timestamp === 0
					? undefined
					: info.timestamp * this.date_granularity,
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

	parseNode(n: OsmPbfNode): OsmNode {
		if (n.id === 21911883) {
			console.error("parser", n)
		}
		const node: OsmNode = {
			id: n.id,
			lon: this.lon_offset + n.lon / this.granularity,
			lat: this.lat_offset + n.lat / this.granularity,
			tags: this.getTags(n.keys, n.vals),
		}
		if (this.#includeInfo && n.info) {
			node.info = this.fillInfo(n.info)
		}
		return node
	}

	parseWay(w: OsmPbfWay): OsmWay {
		let ref = 0
		const way: OsmWay = {
			id: w.id,
			refs: w.refs.map((refSid) => {
				ref += refSid
				return ref
			}),
			tags: this.getTags(w.keys, w.vals),
		}
		if (this.#includeInfo && w.info) {
			way.info = this.fillInfo(w.info)
		}
		return way
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

		const relation: OsmRelation = {
			id: r.id,
			tags: this.getTags(r.keys, r.vals),
			members,
		}
		if (this.#includeInfo && r.info) {
			relation.info = this.fillInfo(r.info)
		}
		return relation
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
				lon: this.lon_offset + delta.lon / this.granularity,
				lat: this.lat_offset + delta.lat / this.granularity,
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
			if (dense.denseinfo && this.#includeInfo) {
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

function assertNonNull(
	o: unknown,
	message?: string,
): asserts o is NonNullable<typeof o> {
	if (o == null) throw Error(message ?? "Expected non-null value")
}
