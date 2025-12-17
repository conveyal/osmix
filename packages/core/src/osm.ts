import type { OsmPbfHeaderBlock } from "@osmix/pbf"
import type { GeoBbox2D } from "@osmix/shared/types"
import { Nodes, type NodesTransferables } from "./nodes"
import { Relations, type RelationsTransferables } from "./relations"
import StringTable, { type StringTableTransferables } from "./stringtable"
import type { BufferType } from "./typed-arrays"
import { Ways, type WaysTransferables } from "./ways"

export interface OsmTransferables<T extends BufferType = BufferType> {
	id: string
	header: OsmPbfHeaderBlock
	stringTable: StringTableTransferables<T>
	nodes: NodesTransferables<T>
	ways: WaysTransferables<T>
	relations: RelationsTransferables<T>
}

export interface OsmInfo {
	id: string
	bbox: GeoBbox2D
	header: OsmPbfHeaderBlock
	stats: {
		nodes: number
		ways: number
		relations: number
	}
}

export interface OsmOptions {
	id: string
	header: OsmPbfHeaderBlock
}

/**
 * OSM Entity Index.
 */
export class Osm {
	// Filename or ID of this OSM Entity index.
	readonly id: string
	readonly header: OsmPbfHeaderBlock

	// Shared string lookup table for all nodes, ways, and relations
	readonly stringTable: StringTable
	readonly nodes: Nodes
	readonly ways: Ways
	readonly relations: Relations

	private indexBuilt = false

	/**
	 * Create a new OSM Entity index.
	 */
	constructor(opts?: Partial<OsmOptions> | OsmTransferables | Osm) {
		this.id = opts?.id ?? "unknown"
		this.header = opts?.header ?? {
			required_features: [],
			optional_features: [],
		}
		if (opts && "stringTable" in opts) {
			if (opts instanceof Osm) {
				this.stringTable = new StringTable(opts.stringTable.transferables())
				this.nodes = new Nodes(this.stringTable, opts.nodes.transferables())
				this.ways = new Ways(
					this.stringTable,
					this.nodes,
					opts.ways.transferables(),
				)
				this.relations = new Relations(
					this.stringTable,
					this.nodes,
					this.ways,
					opts.relations.transferables(),
				)
				this.indexBuilt = true
			} else {
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
			}
		} else {
			this.stringTable = new StringTable()
			this.nodes = new Nodes(this.stringTable)
			this.ways = new Ways(this.stringTable, this.nodes)
			this.relations = new Relations(this.stringTable, this.nodes, this.ways)
		}
	}

	/**
	 * Build the internal indexes for all entities.
	 */
	buildIndexes() {
		this.stringTable.buildIndex()
		this.nodes.buildIndex()
		this.ways.buildIndex()
		this.relations.buildIndex()
		this.indexBuilt = true
	}

	/**
	 * Check if the index is built and ready for use.
	 */
	isReady() {
		return (
			this.nodes.isReady() &&
			this.ways.isReady() &&
			this.relations.isReady() &&
			this.indexBuilt
		)
	}

	/**
	 * Build spatial indexes for all entities.
	 */
	buildSpatialIndexes() {
		this.nodes.buildSpatialIndex()
		this.ways.buildSpatialIndex()
		this.relations.buildSpatialIndex()
	}

	/**
	 * Check if spatial indexes have been built for all entity types.
	 */
	hasSpatialIndexes(): boolean {
		return (
			this.nodes.hasSpatialIndex() &&
			this.ways.hasSpatialIndex() &&
			this.relations.hasSpatialIndex()
		)
	}

	/**
	 * Get the bounding box of all entities in the OSM index.
	 */
	bbox(): GeoBbox2D {
		return this.nodes.getBbox()
	}

	/**
	 * Get information about the OSM index.
	 */
	info(): OsmInfo {
		return {
			id: this.id,
			bbox: this.bbox(),
			header: this.header,
			stats: {
				nodes: this.nodes.size,
				ways: this.ways.size,
				relations: this.relations.size,
			},
		}
	}

	/**
	 * Get transferable objects for passing to another thread.
	 */
	transferables(): OsmTransferables {
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
