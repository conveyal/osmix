import type { OsmPbfRelation } from "@osmix/pbf"
import { assertValue } from "@osmix/shared/assert"
import type {
	GeoBbox2D,
	LonLat,
	OsmEntityType,
	OsmRelation,
	OsmRelationMember,
	OsmTags,
} from "@osmix/shared/types"
import Flatbush from "flatbush"
import { Entities, type EntitiesTransferables } from "./entities"
import { type IdOrIndex, Ids } from "./ids"
import type { Nodes } from "./nodes"
import type StringTable from "./stringtable"
import { Tags } from "./tags"
import {
	BufferConstructor,
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
	bbox: BufferType
	spatialIndex: BufferType
}

export class Relations extends Entities<OsmRelation> {
	private stringTable: StringTable

	private memberStart: RTA<Uint32Array>
	private memberCount: RTA<Uint16Array> // Maximum 65,535 members per relation

	// Store the ID of the member because relations have other relations as members.
	private memberRefs: RTA<Float64Array>
	private memberTypes: RTA<Uint8Array>
	private memberRoles: RTA<Uint32Array>

	// Spatial index
	private spatialIndex: Flatbush = new Flatbush(1)

	// Bounding box of the relation in geographic coordinates
	private bbox: RTA<Float64Array>

	// Node and Way indexes
	private nodes: Nodes
	private ways: Ways

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
			this.bbox = RTA.from(Float64Array, transferables.bbox)
			this.spatialIndex = Flatbush.from(transferables.spatialIndex)
			this.indexBuilt = true
		} else {
			super("relation", new Ids(), new Tags(stringTable))
			this.memberStart = new RTA(Uint32Array)
			this.memberCount = new RTA(Uint16Array)
			this.memberRefs = new RTA(IdArrayType)
			this.memberTypes = new RTA(Uint8Array)
			this.memberRoles = new RTA(Uint32Array)
			this.bbox = new RTA(Float64Array)
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
		this.bbox.compact()
	}

	buildSpatialIndex() {
		console.time("RelationIndex.buildSpatialIndex")
		if (!this.nodes.isReady()) throw Error("Node index is not ready.")
		if (!this.ways.isReady()) throw Error("Way index is not ready.")
		if (this.size === 0) return this.spatialIndex

		this.spatialIndex = new Flatbush(
			this.size,
			128,
			Float64Array,
			BufferConstructor,
		)
		for (let i = 0; i < this.size; i++) {
			const lls: LonLat[] = []
			const start = this.memberStart.at(i)
			const count = this.memberCount.at(i)
			for (let j = start; j < start + count; j++) {
				const type = RELATION_MEMBER_TYPES[this.memberTypes.at(j)]
				if (type === "node") {
					const refId = this.memberRefs.at(j)
					const ll = this.nodes.getNodeLonLat({ id: refId })
					lls.push(ll)
				} else if (type === "way") {
					const wayId = this.memberRefs.at(j)
					const wayIndex = this.ways.ids.getIndexFromId(wayId)
					if (wayIndex === -1) continue
					const wayPositions = this.ways.getCoordinates(wayIndex)
					lls.push(...wayPositions)
				}
			}
			const bbox = bboxFromLonLats(lls)
			this.bbox.push(bbox[0])
			this.bbox.push(bbox[1])
			this.bbox.push(bbox[2])
			this.bbox.push(bbox[3])
			this.spatialIndex.add(bbox[0], bbox[1], bbox[2], bbox[3])
		}
		this.spatialIndex.finish()
		console.timeEnd("RelationIndex.buildSpatialIndex")
		return this.spatialIndex
	}

	getNodeBbox(i: IdOrIndex): GeoBbox2D {
		const index = "index" in i ? i.index : this.ids.idOrIndex(i)[0]
		return [
			this.bbox.at(index * 4),
			this.bbox.at(index * 4 + 1),
			this.bbox.at(index * 4 + 2),
			this.bbox.at(index * 4 + 3),
		]
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
	 */
	intersects(bbox: GeoBbox2D, filterFn?: (index: number) => boolean): number[] {
		return this.spatialIndex.search(
			bbox[0],
			bbox[1],
			bbox[2],
			bbox[3],
			filterFn,
		)
	}

	neighbors(
		x: number,
		y: number,
		maxResults?: number,
		maxDistance?: number,
	): number[] {
		return this.spatialIndex.neighbors(x, y, maxResults, maxDistance)
	}

	override transferables(): RelationsTransferables {
		return {
			...super.transferables(),
			memberStart: this.memberStart.array.buffer,
			memberCount: this.memberCount.array.buffer,
			memberRefs: this.memberRefs.array.buffer,
			memberTypes: this.memberTypes.array.buffer,
			memberRoles: this.memberRoles.array.buffer,
			bbox: this.bbox.array.buffer,
			spatialIndex: this.spatialIndex.data,
		}
	}
}
