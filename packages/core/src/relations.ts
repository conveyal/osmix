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
import { around as geoAround } from "geoflatbush"
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
import { bboxFromLonLats, type ContentHasher } from "./utils"
import type { Ways } from "./ways"

const RELATION_MEMBER_TYPES: OsmEntityType[] = ["node", "way", "relation"]

export interface RelationsTransferables<T extends BufferType = BufferType>
	extends EntitiesTransferables<T> {
	memberStart: T
	memberCount: T
	memberRefs: T
	memberTypes: T
	memberRoles: T
	bbox: T
	/** Optional - can be rebuilt via buildSpatialIndex() */
	spatialIndex?: T
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
	// Track if spatial index was properly built (vs default empty)
	private spatialIndexBuilt = false

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
			// Only load spatial index if provided (not stored in IndexedDB)
			if (transferables.spatialIndex?.byteLength) {
				this.spatialIndex = Flatbush.from(transferables.spatialIndex)
				this.spatialIndexBuilt = true
			}
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
	 * If bbox data already exists (e.g., loaded from storage), reuses it.
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

		// If bbox already has data (loaded from storage), use it directly
		const hasBboxData = this.bbox.length >= this.size * 4
		for (let i = 0; i < this.size; i++) {
			let minX: number
			let minY: number
			let maxX: number
			let maxY: number

			if (hasBboxData) {
				// Use stored bbox values
				minX = this.bbox.at(i * 4)
				minY = this.bbox.at(i * 4 + 1)
				maxX = this.bbox.at(i * 4 + 2)
				maxY = this.bbox.at(i * 4 + 3)
			} else {
				// Calculate bbox from coordinates
				const lls = this.collectRelationCoordinates(i)
				const bbox = bboxFromLonLats(lls)
				minX = bbox[0]
				minY = bbox[1]
				maxX = bbox[2]
				maxY = bbox[3]
				this.bbox.push(minX)
				this.bbox.push(minY)
				this.bbox.push(maxX)
				this.bbox.push(maxY)
			}
			this.spatialIndex.add(minX, minY, maxX, maxY)
		}
		if (!hasBboxData) {
			this.bbox.compact()
		}
		this.spatialIndex.finish()
		this.spatialIndexBuilt = true
		console.timeEnd("RelationIndex.buildSpatialIndex")
		return this.spatialIndex
	}

	/**
	 * Check if the spatial index has been built.
	 */
	hasSpatialIndex(): boolean {
		return this.spatialIndexBuilt
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

	/**
	 * Find relation indexes near a point using great-circle distance.
	 * @param lon - Longitude in degrees.
	 * @param lat - Latitude in degrees.
	 * @param maxResults - Maximum number of results to return.
	 * @param maxDistanceKm - Maximum distance in kilometers.
	 * @returns Array of relation indexes sorted by distance.
	 */
	neighbors(
		lon: number,
		lat: number,
		maxResults?: number,
		maxDistanceKm?: number,
	): number[] {
		if (this.size === 0) return []
		// Use geoflatbush for proper geographic distance calculations
		return geoAround(this.spatialIndex, lon, lat, maxResults, maxDistanceKm)
	}

	/**
	 * Get transferable objects for passing to another thread.
	 * Only includes spatialIndex if it has been built.
	 */
	override transferables(): RelationsTransferables {
		const base = {
			...super.transferables(),
			memberStart: this.memberStart.array.buffer,
			memberCount: this.memberCount.array.buffer,
			memberRefs: this.memberRefs.array.buffer,
			memberTypes: this.memberTypes.array.buffer,
			memberRoles: this.memberRoles.array.buffer,
			bbox: this.bbox.array.buffer,
		}
		// Only include spatial index if it was built
		if (this.spatialIndexBuilt) {
			return { ...base, spatialIndex: this.spatialIndex.data }
		}
		return base
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

	/**
	 * Update a ContentHasher with relation-specific data (members).
	 */
	override updateHash(hasher: ContentHasher): ContentHasher {
		return super
			.updateHash(hasher)
			.update(this.memberStart.array)
			.update(this.memberCount.array)
			.update(this.memberRefs.array)
			.update(this.memberTypes.array)
			.update(this.memberRoles.array)
	}
}
