import {
	OsmBlocksToPbfBytesTransformStream,
	type OsmPbfBlock,
	type OsmPbfHeaderBlock,
} from "@osmix/pbf"
import { OsmPbfBlockBuilder } from "./osm-pbf-block-builder"
import type { OsmEntity } from "./types"
import { isNode, isRelation, isWay } from "./utils"

/**
 * Convert a generator of OSM JSON entities to a generator of OSM PBF blocks. Entities should be grouped and sorted.
 */
export function osmJsonToPbf(
	header: OsmPbfHeaderBlock,
	entities: AsyncGenerator<OsmEntity>,
) {
	return createOsmJsonReadableStream(header, entities)
		.pipeThrough(new OsmJsonToBlocksTransformStream())
		.pipeThrough(new OsmBlocksToPbfBytesTransformStream())
}

/**
 * Create a readable stream of OSM JSON entities from an OSM header.
 */
export function createOsmJsonReadableStream(
	header: OsmPbfHeaderBlock,
	entities: AsyncGenerator<OsmEntity>,
) {
	let headerEnqueued = false
	return new ReadableStream<OsmPbfHeaderBlock | OsmEntity>({
		pull: async (controller) => {
			if (!headerEnqueued) {
				controller.enqueue(header)
				headerEnqueued = true
			}
			const nextEntity = await entities.next()
			if (nextEntity.done) {
				controller.close()
			} else {
				controller.enqueue(nextEntity.value)
			}
		},
	})
}

/**
 * Transform a stream of OSM JSON entities to a stream of OSM PBF blocks.
 */
export class OsmJsonToBlocksTransformStream extends TransformStream<
	OsmPbfHeaderBlock | OsmEntity,
	OsmPbfHeaderBlock | OsmPbfBlock
> {
	block = new OsmPbfBlockBuilder()
	constructor() {
		super({
			transform: async (entity, controller) => {
				if ("id" in entity) {
					if (this.block.isFull()) {
						controller.enqueue(this.block)
						this.block = new OsmPbfBlockBuilder()
					}

					if (isNode(entity)) {
						this.block.addDenseNode(entity)
					} else if (isWay(entity)) {
						// If our block already has nodes, start a new block
						if (
							this.block.group.nodes.length > 0 ||
							this.block.group.dense != null
						) {
							controller.enqueue(this.block)
							this.block = new OsmPbfBlockBuilder()
						}
						this.block.addWay(entity)
					} else if (isRelation(entity)) {
						// If our block already has nodes or ways, start a new block
						if (
							this.block.group.nodes.length > 0 ||
							this.block.group.dense != null ||
							this.block.group.ways.length > 0
						) {
							controller.enqueue(this.block)
							this.block = new OsmPbfBlockBuilder()
						}
						this.block.addRelation(entity)
					}
				} else {
					controller.enqueue(entity)
				}
			},
			flush: async (controller) => {
				if (!this.block.isEmpty()) {
					controller.enqueue(this.block)
				}
			},
		})
	}
}

/**
 * Convert a generator of JSON entities to a generator of OSM PBF blocks. Entities should be grouped and sorted.
 * @param entities - Generator of JSON entities.
 * @returns Generator of OSM PBF blocks.
 */
export async function* jsonEntitiesToBlocks(
	entities: AsyncGenerator<OsmEntity>,
): AsyncGenerator<OsmPbfBlock> {
	let block = new OsmPbfBlockBuilder()
	for await (const entity of entities) {
		if (block.isFull()) {
			yield block
			block = new OsmPbfBlockBuilder()
		}

		if (isNode(entity)) {
			block.addDenseNode(entity)
		} else if (isWay(entity)) {
			// If our block already has nodes, start a new block
			if (block.group.nodes.length > 0 || block.group.dense != null) {
				yield block
				block = new OsmPbfBlockBuilder()
			}
			block.addWay(entity)
		} else if (isRelation(entity)) {
			// If our block already has nodes or ways, start a new block
			if (
				block.group.nodes.length > 0 ||
				block.group.dense != null ||
				block.group.ways.length > 0
			) {
				yield block
				block = new OsmPbfBlockBuilder()
			}
			block.addRelation(entity)
		}
	}

	// Yield any remaining non-empty blocks
	if (!block.isEmpty()) {
		yield block
	}
}
