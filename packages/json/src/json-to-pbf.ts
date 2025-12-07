/**
 * JSON-to-PBF conversion utilities.
 *
 * Transforms typed OSM JSON entities back into spec-compliant PBF byte streams
 * with proper delta encoding, string tables, and block boundaries.
 *
 * @module
 */

import {
	OsmBlocksToPbfBytesTransformStream,
	type OsmPbfBlock,
	type OsmPbfHeaderBlock,
} from "@osmix/pbf"
import type { OsmEntity } from "@osmix/shared/types"
import { isNode, isRelation, isWay } from "@osmix/shared/utils"
import { OsmPbfBlockBuilder } from "./osm-pbf-block-builder"

/**
 * Convert JSON entities to a PBF byte stream.
 *
 * Accepts a header and an async generator of entities (nodes, ways, relations)
 * and produces a complete PBF file as a ReadableStream. Entities should be
 * provided in sorted order: all nodes first, then ways, then relations.
 *
 * @param header - PBF header block with required/optional features.
 * @param entities - Async generator yielding OsmNode, OsmWay, OsmRelation.
 * @returns ReadableStream of PBF bytes.
 *
 * @example
 * ```ts
 * import { osmJsonToPbf } from "@osmix/json"
 *
 * const header = {
 *   required_features: ["OsmSchema-V0.6", "DenseNodes"],
 *   optional_features: [],
 * }
 *
 * const pbfStream = osmJsonToPbf(header, entitiesGenerator)
 * await Bun.write('./output.pbf', pbfStream)
 * ```
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
 * Create a ReadableStream that yields header followed by entities.
 *
 * Wraps an async generator of entities with a header block, producing a
 * stream suitable for piping through `OsmJsonToBlocksTransformStream`.
 *
 * @param header - PBF header block to emit first.
 * @param entities - Async generator yielding OSM entities.
 * @returns ReadableStream yielding header then entities.
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
 * TransformStream that groups JSON entities into PBF primitive blocks.
 *
 * Accepts header and JSON entities, emitting PBF blocks with proper grouping:
 * - Starts new blocks when entity type changes (nodes → ways → relations)
 * - Respects maximum entities per block limit
 * - Uses dense node encoding for efficient node storage
 *
 * @example
 * ```ts
 * const blocksStream = entityStream.pipeThrough(new OsmJsonToBlocksTransformStream())
 * ```
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
 * Convert JSON entities to PBF blocks as an async generator.
 *
 * Groups entities into blocks with proper boundaries and delta encoding.
 * Entities should be provided sorted: nodes first, then ways, then relations.
 *
 * @param entities - Async generator yielding OsmNode, OsmWay, OsmRelation.
 * @yields PBF primitive blocks ready for serialization.
 *
 * @example
 * ```ts
 * import { jsonEntitiesToBlocks, osmBlockToPbfBlobBytes } from "@osmix/json"
 *
 * for await (const block of jsonEntitiesToBlocks(entities)) {
 *   const bytes = await osmBlockToPbfBlobBytes(block)
 *   // Write bytes to file...
 * }
 * ```
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
