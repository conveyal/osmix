import type { OsmPbfRelation } from "@osmix/pbf"
import { Entities, type EntitiesTransferables } from "./entities"
import { Ids } from "./ids"
import type StringTable from "./stringtable"
import { Tags } from "./tags"
import {
	IdArrayType,
	ResizeableTypedArray,
	type TypedArrayBuffer,
} from "./typed-arrays"
import type {
	OsmEntityType,
	OsmRelation,
	OsmRelationMember,
	OsmTags,
} from "./types"

const RELATION_MEMBER_TYPES: OsmEntityType[] = ["node", "way", "relation"]

export interface RelationsTransferables extends EntitiesTransferables {
	memberStart: TypedArrayBuffer
	memberCount: TypedArrayBuffer
	memberRefs: TypedArrayBuffer
	memberTypes: TypedArrayBuffer
	memberRoles: TypedArrayBuffer
}

export class Relations extends Entities<OsmRelation> {
	memberStart = new ResizeableTypedArray(Uint32Array)
	memberCount = new ResizeableTypedArray(Uint16Array) // Maximum 65,535 members per relation

	// Store the ID of the member because relations have other relations as members.
	memberRefs = new ResizeableTypedArray(IdArrayType)
	memberTypes = new ResizeableTypedArray(Uint8Array)
	memberRoles = new ResizeableTypedArray(Uint32Array)

	static from(stringTable: StringTable, rit: RelationsTransferables) {
		const idIndex = Ids.from(rit)
		const tagIndex = Tags.from(stringTable, rit)
		const ri = new Relations(stringTable, idIndex, tagIndex)
		ri.memberStart = ResizeableTypedArray.from(Uint32Array, rit.memberStart)
		ri.memberCount = ResizeableTypedArray.from(Uint16Array, rit.memberCount)
		ri.memberRefs = ResizeableTypedArray.from(IdArrayType, rit.memberRefs)
		ri.memberTypes = ResizeableTypedArray.from(Uint8Array, rit.memberTypes)
		ri.memberRoles = ResizeableTypedArray.from(Uint32Array, rit.memberRoles)
		return ri
	}

	constructor(stringTable: StringTable, idIndex?: Ids, tagIndex?: Tags) {
		super("relation", stringTable, idIndex, tagIndex)
	}

	transferables(): RelationsTransferables {
		return {
			memberStart: this.memberStart.array.buffer,
			memberCount: this.memberCount.array.buffer,
			memberRefs: this.memberRefs.array.buffer,
			memberTypes: this.memberTypes.array.buffer,
			memberRoles: this.memberRoles.array.buffer,
			...this.ids.transferables(),
			...this.tags.transferables(),
		}
	}

	addRelation(relation: OsmRelation) {
		this.ids.add(relation.id)
		this.tags.addTags(relation.tags)
		this.memberStart.push(this.memberRefs.length)
		this.memberCount.push(relation.members.length)
		for (const member of relation.members) {
			this.memberRefs.push(member.ref)
			this.memberTypes.push(RELATION_MEMBER_TYPES.indexOf(member.type))
			this.memberRoles.push(this.stringTable.add(member.role ?? ""))
		}
	}

	addRelations(
		relations: OsmPbfRelation[],
		blockStringIndexMap: Map<number, number>,
	) {
		const blockToStringTable = (k: number) => {
			const index = blockStringIndexMap.get(k)
			if (index === undefined) throw Error("Tag key not found")
			return index
		}

		for (const relation of relations) {
			this.ids.add(relation.id)
			this.memberStart.push(this.memberRefs.length)
			this.memberCount.push(relation.memids.length)

			let refId = 0
			for (let i = 0; i < relation.memids.length; i++) {
				refId += relation.memids[i]
				this.memberRefs.push(refId)
				this.memberTypes.push(relation.types[i])
				this.memberRoles.push(blockToStringTable(relation.roles_sid[i]))
			}

			const tagKeys: number[] = relation.keys.map(blockToStringTable)
			const tagValues: number[] = relation.vals.map(blockToStringTable)
			this.tags.addTagKeysAndValues(tagKeys, tagValues)
		}
	}

	finishEntityIndex() {
		this.memberStart.compact()
		this.memberCount.compact()
		this.memberRefs.compact()
		this.memberTypes.compact()
		this.memberRoles.compact()
	}

	getFullEntity(index: number, id: number, tags?: OsmTags): OsmRelation {
		return {
			id,
			members: this.getMembersByIndex(index),
			tags,
		}
	}

	getMembersByIndex(
		index: number,
		relationMemberTypes = RELATION_MEMBER_TYPES,
	) {
		const start = this.memberStart.at(index)
		const count = this.memberCount.at(index)
		const members: OsmRelationMember[] = []
		for (let i = start; i < start + count; i++) {
			const ref = this.memberRefs.at(i)
			const type = RELATION_MEMBER_TYPES[this.memberTypes.at(i)]
			if (type === undefined) throw Error(`Member type not found: ${i}`)
			if (!relationMemberTypes.includes(type)) continue
			const role = this.stringTable.get(this.memberRoles.at(i))
			members.push({ ref, type, role })
		}
		return members
	}

	includesMember(
		index: number,
		memberRef: number,
		memberType: OsmEntityType,
		memberRole?: string,
	) {
		const start = this.memberStart.array[index]
		const count = this.memberCount.array[index]
		for (let i = start; i < start + count; i++) {
			const type = RELATION_MEMBER_TYPES[this.memberTypes.array[i]]
			if (type !== memberType) continue
			const ref = this.memberRefs.array[i]
			if (ref !== memberRef) continue
			if (
				memberRole !== undefined &&
				this.stringTable.get(this.memberRoles.array[i]) !== memberRole
			)
				continue
			return true
		}
		return false
	}
}
