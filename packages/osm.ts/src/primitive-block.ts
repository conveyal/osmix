import type {
	OsmPbfDenseNodes,
	OsmPbfNode,
	OsmPbfPrimitiveBlock,
	OsmPbfPrimitiveGroup,
	OsmPbfRelation,
	OsmPbfWay,
} from "./proto/osmformat"
import { MEMBER_TYPES } from "./read-osm-pbf"
import type { OsmNode, OsmRelation, OsmWay } from "./types"

const MAX_ENTITIES_PER_BLOCK = 8_000

class PrimitiveGroup implements OsmPbfPrimitiveGroup {
	dense?: OsmPbfDenseNodes
	nodes: OsmPbfNode[] = []
	ways: OsmPbfWay[] = []
	relations: OsmPbfRelation[] = []
}

export class PrimitiveBlock implements OsmPbfPrimitiveBlock {
	stringtable: string[] = [""]
	primitivegroup: OsmPbfPrimitiveGroup[] = []

	#entities = 0

	constructor() {
		this.addGroup()
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

	addDenseNode(node: OsmNode) {
		const tags = this.addTags(node.tags ?? {})
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
}
