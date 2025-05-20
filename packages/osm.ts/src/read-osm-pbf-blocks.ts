import type {
	OsmPbfDenseNodes,
	OsmPbfInfo,
	OsmPbfNode,
	OsmPbfPrimitiveBlock,
	OsmPbfRelation,
	OsmPbfWay,
} from "./proto/osmformat.ts"
import type {
	OsmNode,
	OsmPbfInfoParsed,
	OsmRelation,
	OsmRelationMember,
	OsmWay,
} from "./types.ts"
import { assertNonNull, getString, getTags } from "./utils.ts"

export type ReadOptions = {
	withTags?: boolean
	withInfo?: boolean
}

/**
 * Parse primitive blocks from an OSM PBF stream and return nodes, ways, and relations.
 */
export async function* readOsmPbfPrimitiveBlocks(
	blocks: AsyncGenerator<OsmPbfPrimitiveBlock>,
	opts?: ReadOptions,
): AsyncGenerator<OsmNode | OsmWay | OsmRelation> {
	for await (const block of blocks) {
		for (const group of block.primitivegroup) {
			console.log("processing group")
			console.log("nodes", group.nodes.length)
			console.log("dense", group.dense?.id.length)
			console.log("ways", group.ways.length)
			console.log("relations", group.relations.length)
			for (const n of group.nodes) {
				yield parseNode(n, block, opts)
			}
			if (group.dense) {
				for (const node of parseDenseNodes(group.dense, block, opts)) {
					yield node
				}
			}
			for (const w of group.ways) {
				yield parseWay(w, block, opts)
			}
			for (const r of group.relations) {
				yield parseRelation(r, block, opts)
			}
		}
	}
}

export const MEMBER_TYPES = ["node", "way", "relation"]
export function parseRelation(
	r: OsmPbfRelation,
	block: OsmPbfPrimitiveBlock,
	opts?: ReadOptions,
): OsmRelation {
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
			role: getString(block.stringtable, r.roles_sid, i),
		}
	})

	return {
		id: r.id,
		tags: opts?.withTags
			? getTags(block.stringtable, r.keys, r.vals)
			: undefined,
		info: opts?.withInfo && r.info ? fillInfo(block, r.info) : undefined,
		members,
	}
}

export function parseWay(
	w: OsmPbfWay,
	block: OsmPbfPrimitiveBlock,
	opts?: ReadOptions,
): OsmWay {
	let ref = 0
	const way: OsmWay = {
		id: w.id,
		refs: w.refs.map((refSid) => {
			ref += refSid
			return ref
		}),
		tags: opts?.withTags
			? getTags(block.stringtable, w.keys, w.vals)
			: undefined,
		info: opts?.withInfo && w.info ? fillInfo(block, w.info) : undefined,
	}
	if (opts?.withTags && w.keys.length > 0) {
		way.tags = getTags(block.stringtable, w.keys, w.vals)
	}
	if (opts?.withInfo && w.info) {
		way.info = fillInfo(block, w.info)
	}
	return way
}

export function parseNode(
	n: OsmPbfNode,
	block: OsmPbfPrimitiveBlock,
	opts?: ReadOptions,
): OsmNode {
	const node: OsmNode = {
		id: n.id,
		lon: (block.lon_offset ?? 0) + n.lon / (block.granularity ?? 1e7),
		lat: (block.lat_offset ?? 0) + n.lat / (block.granularity ?? 1e7),
		tags: opts?.withTags
			? getTags(block.stringtable, n.keys, n.vals)
			: undefined,
		info: opts?.withInfo && n.info ? fillInfo(block, n.info) : undefined,
	}
	if (opts?.withTags && n.keys.length > 0) {
		node.tags = getTags(block.stringtable, n.keys, n.vals)
	}
	if (opts?.withInfo && n.info) {
		node.info = fillInfo(block, n.info)
	}
	return node
}

export function parseDenseNodes(
	dense: OsmPbfDenseNodes,
	block: OsmPbfPrimitiveBlock,
	opts?: ReadOptions,
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

	const granularity = block.granularity ?? 1e7
	const latOffset = block.lat_offset ?? 0
	const lonOffset = block.lon_offset ?? 0
	const dateGranularity = block.date_granularity ?? 1000

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
			lon: lonOffset + delta.lon / granularity,
			lat: latOffset + delta.lat / granularity,
		}
		if (opts?.withTags && dense.keys_vals.length > 0) {
			node.tags = {}
			while (dense.keys_vals[keysValsIndex] !== 0) {
				const key = getString(block.stringtable, dense.keys_vals, keysValsIndex)
				const val = getString(
					block.stringtable,
					dense.keys_vals,
					keysValsIndex + 1,
				)
				if (key && val) {
					node.tags[key] = val
				}
				keysValsIndex += 2
			}
			keysValsIndex++
		}
		if (opts?.withInfo && dense.denseinfo) {
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

function fillInfo(
	block: OsmPbfPrimitiveBlock,
	info: OsmPbfInfo,
): OsmPbfInfoParsed {
	return {
		...info,
		timestamp:
			info.timestamp === undefined || info.timestamp === 0
				? undefined
				: info.timestamp * (block.date_granularity ?? 1000),
		user:
			info.user_sid === undefined || block.stringtable[info.user_sid]
				? undefined
				: block.stringtable[info.user_sid],
	}
}
