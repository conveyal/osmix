import type {
	OsmEntityType,
	OsmRelation,
	OsmRelationMember,
	OsmTags,
} from "@osmix/json"
import type { OsmPbfRelation } from "@osmix/pbf"
import { assertValue } from "@osmix/shared/assert"
import { Entities, type EntitiesTransferables } from "./entities"
import { Ids } from "./ids"
import type StringTable from "./stringtable"
import { Tags } from "./tags"
import {
	type BufferType,
	IdArrayType,
	ResizeableTypedArray,
} from "./typed-arrays"

const RELATION_MEMBER_TYPES: OsmEntityType[] = ["node", "way", "relation"]

export interface RelationsTransferables extends EntitiesTransferables {
	memberStart: BufferType
	memberCount: BufferType
	memberRefs: BufferType
	memberTypes: BufferType
	memberRoles: BufferType
}

export class Relations extends Entities<OsmRelation> {
	memberStart: ResizeableTypedArray<Uint32Array>
	memberCount: ResizeableTypedArray<Uint16Array> // Maximum 65,535 members per relation

	// Store the ID of the member because relations have other relations as members.
	memberRefs: ResizeableTypedArray<Float64Array>
	memberTypes: ResizeableTypedArray<Uint8Array>
	memberRoles: ResizeableTypedArray<Uint32Array>

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
		this.memberStart = new ResizeableTypedArray(Uint32Array)
		this.memberCount = new ResizeableTypedArray(Uint16Array)
		this.memberRefs = new ResizeableTypedArray(IdArrayType)
		this.memberTypes = new ResizeableTypedArray(Uint8Array)
		this.memberRoles = new ResizeableTypedArray(Uint32Array)
	}

	override transferables(): RelationsTransferables {
		return {
			...super.transferables(),
			memberStart: this.memberStart.array.buffer,
			memberCount: this.memberCount.array.buffer,
			memberRefs: this.memberRefs.array.buffer,
			memberTypes: this.memberTypes.array.buffer,
			memberRoles: this.memberRoles.array.buffer,
		}
	}

	addRelation(relation: OsmRelation) {
		const relationIndex = this.addEntity(relation.id, relation.tags ?? {})
		this.memberStart.push(this.memberRefs.length)
		this.memberCount.push(relation.members.length)
		for (const member of relation.members) {
			this.memberRefs.push(member.ref)
			this.memberTypes.push(RELATION_MEMBER_TYPES.indexOf(member.type))
			this.memberRoles.push(this.stringTable.add(member.role ?? ""))
		}
		return relationIndex
	}

	addRelations(
		relations: OsmPbfRelation[],
		blockStringIndexMap: Map<number, number>,
		filter?: (relation: OsmRelation) => OsmRelation | null,
	): number {
		const blockToStringTable = (k: number) => {
			const index = blockStringIndexMap.get(k)
			if (index === undefined) throw Error("Tag key not found")
			return index
		}

		let added = 0
		for (const relation of relations) {
			const members: OsmRelationMember[] = []
			const memberRefs: number[] = []
			const memberTypes: number[] = []
			const memberRoles: number[] = []

			let refId = 0
			for (let i = 0; i < relation.memids.length; i++) {
				const memid = relation.memids[i]
				const roleSid = relation.roles_sid[i]
				const typeIndex = relation.types[i]
				assertValue(memid, "Relation member ID is undefined")
				assertValue(roleSid, "Relation member role SID is undefined")
				assertValue(typeIndex, "Relation member type is undefined")

				refId += memid
				const roleIndex = blockToStringTable(roleSid)
				const type = RELATION_MEMBER_TYPES[typeIndex]
				assertValue(type, "Relation member type not found")

				if (filter) {
					members.push({
						type,
						ref: refId,
						role: this.stringTable.get(roleIndex),
					})
				}

				memberRefs.push(refId)
				memberTypes.push(typeIndex)
				memberRoles.push(roleIndex)
			}

			const tagKeys: number[] = relation.keys.map(blockToStringTable)
			const tagValues: number[] = relation.vals.map(blockToStringTable)

			const filteredRelation = filter
				? filter({
						id: relation.id,
						members,
						tags: this.tags.getTagsFromIndices(tagKeys, tagValues),
					})
				: null
			if (filter && filteredRelation === null) continue
			added++

			this.addEntity(relation.id, tagKeys, tagValues)
			this.memberStart.push(this.memberRefs.length)
			this.memberCount.push(
				filteredRelation?.members.length ?? memberRefs.length,
			)
			this.memberRefs.pushMany(
				filteredRelation?.members.map((m) => m.ref) ?? memberRefs,
			)
			this.memberTypes.pushMany(
				filteredRelation?.members.map((m) =>
					RELATION_MEMBER_TYPES.indexOf(m.type),
				) ?? memberTypes,
			)
			this.memberRoles.pushMany(
				filteredRelation?.members.map((m) =>
					this.stringTable.add(m.role ?? ""),
				) ?? memberRoles,
			)
		}
		return added
	}

	buildEntityIndex() {
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
		const start = this.memberStart.at(index)
		const count = this.memberCount.at(index)
		for (let i = start; i < start + count; i++) {
			const type = RELATION_MEMBER_TYPES[this.memberTypes.at(i)]
			if (type !== memberType) continue
			const ref = this.memberRefs.at(i)
			if (ref !== memberRef) continue
			if (
				memberRole !== undefined &&
				this.stringTable.get(this.memberRoles.at(i)) !== memberRole
			)
				continue
			return true
		}
		return false
	}
}
