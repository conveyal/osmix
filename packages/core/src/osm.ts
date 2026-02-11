import type { OsmPbfHeaderBlock } from "@osmix/pbf"
import { ContentHasher } from "@osmix/shared/content-hasher"
import type { GeoBbox2D } from "@osmix/shared/types"
import { Nodes, type NodesTransferables } from "./nodes"
import { Relations, type RelationsTransferables } from "./relations"
import StringTable, { type StringTableTransferables } from "./stringtable"
import type { BufferType } from "./typed-arrays"
import { Ways, type WaysTransferables } from "./ways"

export interface OsmTransferables<T extends BufferType = BufferType> {
	id: string
	header: OsmPbfHeaderBlock
	contentHash: string
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
	private _contentHash = ""

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
				this._contentHash = opts._contentHash
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
				this._contentHash = opts.contentHash
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
	 * Also computes the content hash after indexes are built.
	 */
	buildIndexes() {
		this.stringTable.buildIndex()
		this.nodes.buildIndex()
		this.ways.buildIndex()
		this.relations.buildIndex()
		this.indexBuilt = true
		// Compute content hash after indexes are built
		this._contentHash = this.computeContentHash()
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
			contentHash: this._contentHash,
			stringTable: this.stringTable.transferables(),
			nodes: this.nodes.transferables(),
			ways: this.ways.transferables(),
			relations: this.relations.transferables(),
		}
	}

	/**
	 * Get the content hash of this OSM dataset.
	 * The hash is computed when indexes are built.
	 *
	 * @returns A hex string hash uniquely identifying the content.
	 */
	contentHash(): string {
		return this._contentHash
	}

	/**
	 * Check if this OSM dataset has identical content to another.
	 * Uses the pre-computed content hash for fast comparison.
	 *
	 * @param other - The other Osm instance to compare with.
	 * @returns True if both datasets have identical content.
	 */
	isEqual(other: Osm | null | undefined): boolean {
		if (!other) return false
		return this._contentHash === other._contentHash
	}

	/**
	 * Compute a content hash of all underlying data.
	 * This hash uniquely identifies the dataset content regardless of metadata.
	 *
	 * @returns A hex string hash of the content.
	 */
	private computeContentHash(): string {
		const hasher = new ContentHasher()
		// Hash string table first (shared by all entities)
		this.stringTable.updateHash(hasher)
		// Hash each entity collection
		this.nodes.updateHash(hasher)
		this.ways.updateHash(hasher)
		this.relations.updateHash(hasher)
		return hasher.digest()
	}
}
