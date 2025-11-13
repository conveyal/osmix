import type {
	OsmEntityType,
	OsmRelation,
	OsmRelationMember,
	OsmTags,
} from "@osmix/json"
import type { OsmPbfRelation } from "@osmix/pbf"
import { assertValue } from "@osmix/shared/assert"
import type { GeoBbox2D, LonLat } from "@osmix/shared/types"
import { Entities, type EntitiesTransferables } from "./entities"
import { type IdOrIndex, Ids } from "./ids"
import type { Nodes } from "./nodes"
import type StringTable from "./stringtable"
import { Tags } from "./tags"
import {
	type BufferType,
	IdArrayType,
	ResizeableTypedArray as RTA,
} from "./typed-arrays"
import { bboxFromLonLats } from "./utils"
import type { Ways } from "./ways"

const RELATION_MEMBER_TYPES: OsmEntityType[] = ["node", "way", "relation"]

export interface RelationsTransferables extends EntitiesTransferables {
	memberStart: BufferType
	memberCount: BufferType
	memberRefs: BufferType
	memberTypes: BufferType
	memberRoles: BufferType
}

export class Relations extends Entities<OsmRelation> {
	stringTable: StringTable

	memberStart: RTA<Uint32Array>
	memberCount: RTA<Uint16Array> // Maximum 65,535 members per relation

	// Store the ID of the member because relations have other relations as members.
	memberRefs: RTA<Float64Array>
	memberTypes: RTA<Uint8Array>
	memberRoles: RTA<Uint32Array>

	// Node and Way indexes
	nodes: Nodes
	ways: Ways

	constructor(
		stringTable: StringTable,
		nodes: Nodes,
		ways: Ways,
		transferables?: RelationsTransferables,
	) {
		if (transferables) {
			super(
				"relation",
				new Ids(transferables),
				new Tags(stringTable, transferables),
			)
			this.memberStart = RTA.from(Uint32Array, transferables.memberStart)
			this.memberCount = RTA.from(Uint16Array, transferables.memberCount)
			this.memberRefs = RTA.from(IdArrayType, transferables.memberRefs)
			this.memberTypes = RTA.from(Uint8Array, transferables.memberTypes)
			this.memberRoles = RTA.from(Uint32Array, transferables.memberRoles)
			this.indexBuilt = true
		} else {
			super("relation", new Ids(), new Tags(stringTable))
			this.memberStart = new RTA(Uint32Array)
			this.memberCount = new RTA(Uint16Array)
			this.memberRefs = new RTA(IdArrayType)
			this.memberTypes = new RTA(Uint8Array)
			this.memberRoles = new RTA(Uint32Array)
		}
		this.nodes = nodes
		this.ways = ways
		this.stringTable = stringTable
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
		blockStringIndexMap: Uint32Array,
		filter?: (relation: OsmRelation) => OsmRelation | null,
	): number {
		const blockToStringTable = (k: number) => {
			const index = blockStringIndexMap[k]
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

	getBbox(i: IdOrIndex): GeoBbox2D {
		const index = "index" in i ? i.index : this.ids.idOrIndex(i)[0]
		const relation = this.getFullEntity(index, this.ids.at(index))
		const lls: LonLat[] = []
		for (const member of relation.members) {
			if (member.type === "node") {
				const ll = this.nodes.getNodeLonLat({ id: member.ref })
				lls.push(ll)
			} else if (member.type === "way") {
				const wayIndex = this.ways.ids.getIndexFromId(member.ref)
				if (wayIndex === -1) throw Error("Way not found")
				const wayPositions = this.ways.getCoordinates(wayIndex, this.nodes)
				lls.push(...wayPositions)
			}
		}
		return bboxFromLonLats(lls)
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

	/**
	 * Get all way IDs that are members of relations.
	 * Used to exclude these ways from individual rendering.
	 *
	 * TODO: Should this be stored in the relation index?
	 */
	getWayMemberIds(): Set<number> {
		const wayIds = new Set<number>()
		for (let i = 0; i < this.size; i++) {
			const start = this.memberStart.at(i)
			const count = this.memberCount.at(i)
			for (let j = start; j < start + count; j++) {
				const type = RELATION_MEMBER_TYPES[this.memberTypes.at(j)]
				if (type === "way") {
					const wayId = this.memberRefs.at(j)
					if (wayId !== undefined) {
						wayIds.add(wayId)
					}
				}
			}
		}
		return wayIds
	}

	/**
	 * Find relations that intersect a bounding box.
	 * Uses way spatial indexes - relations don't have their own spatial index.
	 * A relation intersects if any of its member ways intersect the bbox.
	 */
	intersects(bbox: GeoBbox2D, filterFn?: (index: number) => boolean): number[] {
		// First, find all ways that intersect the bbox
		const intersectingWayIndexes = this.ways.intersects(bbox)
		const intersectingWayIds = new Set<number>()
		for (const wayIndex of intersectingWayIndexes) {
			const wayId = this.ways.ids.at(wayIndex)
			if (wayId !== undefined) {
				intersectingWayIds.add(wayId)
			}
		}

		// Then, find relations that have any of these ways as members
		const relationIndexes: number[] = []
		for (let i = 0; i < this.size; i++) {
			if (filterFn && !filterFn(i)) continue

			const start = this.memberStart.at(i)
			const count = this.memberCount.at(i)
			for (let j = start; j < start + count; j++) {
				const type = RELATION_MEMBER_TYPES[this.memberTypes.at(j)]
				if (type === "way") {
					const wayId = this.memberRefs.at(j)
					if (wayId !== undefined && intersectingWayIds.has(wayId)) {
						relationIndexes.push(i)
						break // Found a matching way, no need to check more
					}
				}
			}
		}

		return relationIndexes
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
}
