import type { OsmEntityType, OsmEntityTypeMap } from "@osmix/json"
import type { OsmPbfHeaderBlock } from "@osmix/pbf"
import type { GeoBbox2D } from "@osmix/shared/types"
import { Nodes, type NodesTransferables } from "./nodes"
import { Relations, type RelationsTransferables } from "./relations"
import StringTable, { type StringTableTransferables } from "./stringtable"
import { Ways, type WaysTransferables } from "./ways"

export interface OsmixTransferables {
	id: string
	header: OsmPbfHeaderBlock
	stringTable: StringTableTransferables
	nodes: NodesTransferables
	ways: WaysTransferables
	relations: RelationsTransferables
}

export interface OsmixOptions {
	id: string
	header: OsmPbfHeaderBlock
}

/**
 * OSM Entity Index.
 */
export class Osmix {
	// Filename or ID of this OSM Entity index.
	id = "unknown"
	header: OsmPbfHeaderBlock = {
		required_features: [],
		optional_features: [],
	}

	// Shared string lookup table for all nodes, ways, and relations
	stringTable: StringTable
	nodes: Nodes
	ways: Ways
	relations: Relations

	private indexBuilt = false

	constructor(opts?: Partial<OsmixOptions> | OsmixTransferables) {
		this.id = opts?.id ?? "unknown"
		this.header = opts?.header ?? {
			required_features: [],
			optional_features: [],
		}
		if (opts && "stringTable" in opts) {
			this.stringTable = new StringTable(opts.stringTable)
			this.nodes = new Nodes(this.stringTable, opts.nodes)
			this.ways = new Ways(this.stringTable, this.nodes, opts.ways)
			this.relations = new Relations(
				this.stringTable,
				this.nodes,
				this.ways,
				opts.relations,
			)
			this.indexBuilt = true
		} else {
			this.stringTable = new StringTable()
			this.nodes = new Nodes(this.stringTable)
			this.ways = new Ways(this.stringTable, this.nodes)
			this.relations = new Relations(this.stringTable, this.nodes, this.ways)
		}
	}

	buildIndexes() {
		this.stringTable.buildIndex()
		this.nodes.buildIndex()
		this.ways.buildIndex()
		this.relations.buildIndex()
		this.indexBuilt = true
	}

	isReady() {
		return (
			this.nodes.isReady() &&
			this.ways.isReady() &&
			this.relations.isReady() &&
			this.indexBuilt
		)
	}

	buildSpatialIndexes() {
		this.nodes.buildSpatialIndex()
		this.ways.buildSpatialIndex()
	}

	get<T extends OsmEntityType>(
		type: T,
		id: number,
	): OsmEntityTypeMap[T] | undefined {
		if (type === "node") return this.nodes.get({ id }) as OsmEntityTypeMap[T]
		if (type === "way") return this.ways.get({ id }) as OsmEntityTypeMap[T]
		if (type === "relation")
			return this.relations.get({ id }) as OsmEntityTypeMap[T]
	}

	/**
	 * Get the bounding box of all entities in the OSM index.
	 */
	bbox(): GeoBbox2D {
		return this.nodes.bbox
	}

	transferables(): OsmixTransferables {
		return {
			id: this.id,
			header: this.header,
			stringTable: this.stringTable.transferables(),
			nodes: this.nodes.transferables(),
			ways: this.ways.transferables(),
			relations: this.relations.transferables(),
		}
	}
}
