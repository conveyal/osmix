import type { OsmPbfRelation } from "@osmix/pbf"
import { assertValue } from "@osmix/shared/assert"
import {
	buildRelationLineStrings,
	collectRelationPoints,
	isAreaRelation,
	isLineRelation,
	isPointRelation,
	isSuperRelation,
	resolveRelationMembers,
} from "@osmix/shared/relation-kind"
import { buildRelationRings } from "@osmix/shared/relation-multipolygon"
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

	/**
	 * Create a new Relations index.
	 */
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

	/**
	 * Add a single relation to the index.
	 */
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

	/**
	 * Bulk add relations directly from a PBF PrimitiveBlock.
	 */
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

	/**
	 * Compact the internal arrays to free up memory.
	 */
	buildEntityIndex() {
		this.memberStart.compact()
		this.memberCount.compact()
		this.memberRefs.compact()
		this.memberTypes.compact()
		this.memberRoles.compact()
	}

	/**
	 * Build the spatial index for relations.
	 * Handles nested relations by resolving all descendant nodes and ways.
	 */
	buildSpatialIndex() {
		if (!this.nodes.isReady()) throw Error("Node index is not ready.")
		if (!this.ways.isReady()) throw Error("Way index is not ready.")
		if (this.size === 0) return this.spatialIndex
		console.time("RelationIndex.buildSpatialIndex")

		this.spatialIndex = new Flatbush(
			this.size,
			128,
			Float64Array,
			BufferConstructor,
		)
		for (let i = 0; i < this.size; i++) {
			const lls = this.collectRelationCoordinates(i)
			const bbox = bboxFromLonLats(lls)
			this.bbox.push(bbox[0])
			this.bbox.push(bbox[1])
			this.bbox.push(bbox[2])
			this.bbox.push(bbox[3])
			this.spatialIndex.add(bbox[0], bbox[1], bbox[2], bbox[3])
		}
		this.spatialIndex.finish()
		this.bbox.compact()
		console.timeEnd("RelationIndex.buildSpatialIndex")
		return this.spatialIndex
	}

	/**
	 * Collect all coordinates from a relation, including nested relations.
	 * Used for building bounding boxes and spatial indexes.
	 */
	private collectRelationCoordinates(index: number): LonLat[] {
		const lls: LonLat[] = []
		const relation = this.getByIndex(index)

		// Resolve nested relations to get all descendant nodes and ways
		const resolved = resolveRelationMembers(
			relation,
			(relId) => {
				const relIndex = this.ids.getIndexFromId(relId)
				if (relIndex === -1) return null
				return this.getByIndex(relIndex)
			},
			10, // max depth
		)

		// Collect coordinates from resolved nodes
		for (const nodeId of resolved.nodes) {
			const ll = this.nodes.getNodeLonLat({ id: nodeId })
			if (ll) lls.push(ll)
		}

		// Collect coordinates from resolved ways
		for (const wayId of resolved.ways) {
			const wayIndex = this.ways.ids.getIndexFromId(wayId)
			if (wayIndex === -1) continue
			const wayPositions = this.ways.getCoordinates(wayIndex)
			lls.push(...wayPositions)
		}

		return lls
	}

	/**
	 * Get the bounding box of a relation.
	 */
	getEntityBbox(i: IdOrIndex): GeoBbox2D {
		const index = "index" in i ? i.index : this.ids.idOrIndex(i)[0]
		return [
			this.bbox.at(index * 4),
			this.bbox.at(index * 4 + 1),
			this.bbox.at(index * 4 + 2),
			this.bbox.at(index * 4 + 3),
		]
	}

	/**
	 * Get the full relation entity.
	 */
	getFullEntity(index: number, id: number, tags?: OsmTags): OsmRelation {
		return {
			id,
			members: this.getMembersByIndex(index),
			tags,
		}
	}

	/**
	 * Get the members of a relation.
	 */
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

	/**
	 * Check if a relation includes a specific member.
	 */
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
	 * Get all way IDs that are members of relations, including nested relations.
	 * Used to exclude these ways from individual rendering.
	 */
	getWayMemberIds(): Set<number> {
		const wayIds = new Set<number>()
		for (let i = 0; i < this.size; i++) {
			const relation = this.getByIndex(i)
			const resolved = resolveRelationMembers(
				relation,
				(relId) => {
					const relIndex = this.ids.getIndexFromId(relId)
					if (relIndex === -1) return null
					return this.getByIndex(relIndex)
				},
				10, // max depth
			)
			for (const wayId of resolved.ways) {
				wayIds.add(wayId)
			}
		}
		return wayIds
	}

	/**
	 * Get relation geometry based on its kind.
	 * Returns coordinates suitable for rendering based on relation type.
	 * @param index - Relation index
	 * @returns Object with geometry data based on relation kind
	 */
	getRelationGeometry(index: number): {
		points?: LonLat[]
		lineStrings?: LonLat[][]
		rings?: LonLat[][][]
	} {
		const relation = this.getByIndex(index)
		if (isAreaRelation(relation)) {
			return {
				rings: buildRelationRings(
					relation,
					(ref) => this.ways.getById(ref),
					(id) => this.nodes.getNodeLonLat({ id }),
				),
			}
		}

		// Point relations
		if (isPointRelation(relation)) {
			return {
				points: collectRelationPoints(relation, (id) =>
					this.nodes.getNodeLonLat({ id }),
				),
			}
		}

		// Line relations
		if (isLineRelation(relation)) {
			return {
				lineStrings: buildRelationLineStrings(
					relation,
					(ref) => this.ways.getById(ref),
					(id) => this.nodes.getNodeLonLat({ id }),
				),
			}
		}

		// Super relations are handled by individual relation geometry methods
		if (isSuperRelation(relation)) {
			return {}
		}

		// Area relations are handled by buildRelationRings in shared/relation-multipolygon
		// This method doesn't duplicate that logic

		return {}
	}

	/**
	 * Find relations that intersect a bounding box.
	 */
	intersects(bbox: GeoBbox2D, filterFn?: (index: number) => boolean): number[] {
		if (this.size === 0) return []
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
		if (this.size === 0) return []
		return this.spatialIndex.neighbors(x, y, maxResults, maxDistance)
	}

	/**
	 * Get transferable objects for passing to another thread.
	 */
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

	/**
	 * Get the approximate memory requirements for a given number of relations in bytes.
	 */
	static getBytesRequired(count: number) {
		if (count === 0) return 0
		// Approximate members per relation
		let numNodes = count
		let n = count
		while (n !== 1) {
			n = Math.ceil(n / 128)
			numNodes += n
		}
		const indexBytes = (numNodes < 16384 ? 2 : 4) * numNodes
		const boxesBytes = numNodes * 4 * Float64Array.BYTES_PER_ELEMENT
		const spatialIndexBytes = 8 + indexBytes + boxesBytes

		return (
			Ids.getBytesRequired(count) +
			Tags.getBytesRequired(count) +
			count * Uint32Array.BYTES_PER_ELEMENT + // memberStart
			count * Uint16Array.BYTES_PER_ELEMENT + // memberCount
			count * 4 * Float64Array.BYTES_PER_ELEMENT + // bbox
			spatialIndexBytes
		)
	}
}
