import { ResizeableIdArray, ResizeableTypedArray } from "./typed-arrays"
import { EntityIndex } from "./entity-index"
import type { NodeIndex } from "./node-index"
import type StringTable from "./stringtable"
import type { OsmRelation, OsmRelationMember, OsmTags } from "./types"
import type { WayIndex } from "./way-index"

const RELATION_MEMBER_TYPES = ["node", "way", "relation"] as const

export class RelationIndex extends EntityIndex<OsmRelation> {
	memberStartByIndex = new ResizeableTypedArray(Uint32Array)
	memberCountByIndex = new ResizeableTypedArray(Uint16Array) // Maximum 65,535 members per relation

	// Store the ID of the member because relations have other relations as members.
	memberRefsIndex = new ResizeableIdArray()
	memberTypesIndex = new ResizeableTypedArray(Uint8Array)
	memberRolesIndex = new ResizeableTypedArray(Uint32Array)

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
		this.ids.add(relation.id)
		this.tags.addTags(relation.tags)
		this.memberStartByIndex.push(this.memberRefsIndex.length)
		this.memberCountByIndex.push(relation.members.length)
		for (const member of relation.members) {
			this.memberRefsIndex.push(member.ref)
			this.memberTypesIndex.push(RELATION_MEMBER_TYPES.indexOf(member.type))
			this.memberRolesIndex.push(this.stringTable.add(member.role ?? ""))
		}
	}

	finishEntityIndex() {
		this.memberStartByIndex.compact()
		this.memberCountByIndex.compact()
		this.memberRefsIndex.compact()
		this.memberTypesIndex.compact()
		this.memberRolesIndex.compact()
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
		for (let i = start; i < start + count; i++) {
			const ref = this.memberRefsIndex.at(i)
			const type = RELATION_MEMBER_TYPES[this.memberTypesIndex.at(i)]
			const role = this.stringTable.get(this.memberRolesIndex.at(i))
			members.push({ ref, type, role })
		}
		return members
	}
}
