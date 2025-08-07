import { ResizeableTypedArray } from "./typed-arrays"
import { EntityIndex } from "./entity-index"
import type { NodeIndex } from "./node-index"
import type StringTable from "./stringtable"
import type { OsmRelation, OsmRelationMember, OsmTags } from "./types"
import type { WayIndex } from "./way-index"

const MEMBER_TYPES = ["node", "way", "relation"] as const

export class RelationIndex extends EntityIndex<OsmRelation> {
	memberStartByIndex = new ResizeableTypedArray(Uint32Array)
	memberCountByIndex = new ResizeableTypedArray(Uint16Array) // Maximum 65,535 members per relation
	memberIndexes = new ResizeableTypedArray(Uint32Array)

	// Store the index of the member in the node index. Not the ID
	memberRefByIndex = new ResizeableTypedArray(Uint32Array)
	memberTypeByIndex = new ResizeableTypedArray(Uint8Array)
	memberRoleByIndex = new ResizeableTypedArray(Uint32Array)

	nodeIndex: NodeIndex
	wayIndex: WayIndex

	constructor(
		stringTable: StringTable,
		nodeIndex: NodeIndex,
		wayIndex: WayIndex,
	) {
		super(stringTable, "relation")
		this.nodeIndex = nodeIndex
		this.wayIndex = wayIndex
	}

	addRelation(relation: OsmRelation) {
		super.add(relation.id)
		this.addTags(relation.tags)
		this.memberStartByIndex.push(this.memberIndexes.length)
		this.memberCountByIndex.push(relation.members.length)
		for (const member of relation.members) {
			const index =
				member.type === "node"
					? this.nodeIndex.getIndexFromId(member.ref)
					: this.wayIndex.getIndexFromId(member.ref)
			this.memberIndexes.push(index)
			this.memberTypeByIndex.push(MEMBER_TYPES.indexOf(member.type))
			this.memberRoleByIndex.push(this.stringTable.add(member.role ?? ""))
		}
	}

	finishEntityIndex() {
		this.memberStartByIndex.compact()
		this.memberCountByIndex.compact()
		this.memberIndexes.compact()
		this.memberRefByIndex.compact()
		this.memberTypeByIndex.compact()
		this.memberRoleByIndex.compact()
	}

	getFullEntity(index: number, id: number, tags?: OsmTags): OsmRelation {
		return {
			id,
			members: this.getMembersByIndex(index),
			tags,
		}
	}

	getMembersByIndex(index: number) {
		const start = this.memberStartByIndex.at(index)
		const count = this.memberCountByIndex.at(index)
		const members: OsmRelationMember[] = []
		for (let i = 0; i < count; i++) {
			const refType = MEMBER_TYPES[this.memberTypeByIndex.at(start + i)]
			const index = this.memberIndexes.at(start + i)
			const role = this.stringTable.get(this.memberRoleByIndex.at(start + i))
			const id =
				refType === "node"
					? this.nodeIndex.idByIndex.at(index)
					: this.wayIndex.idByIndex.at(index)
			members.push({
				ref: id,
				type: refType,
				role,
			})
		}
		return members
	}

	set(_: OsmRelation) {
		throw Error("RelationIndex.set not implemented yet")
	}
}
