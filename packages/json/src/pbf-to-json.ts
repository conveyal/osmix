/**
 * PBF-to-JSON conversion utilities.
 *
 * Transforms raw OSM PBF byte streams into typed JSON entities with decoded
 * string tables, resolved coordinates, and parsed tags.
 *
 * @module
 */

import {
	type OsmPbfBlock,
	OsmPbfBytesToBlocksTransformStream,
	type OsmPbfHeaderBlock,
} from "@osmix/pbf"
import type { OsmEntity } from "@osmix/shared/types"
import { OsmPbfBlockParser } from "./osm-pbf-block-parser"

/**
 * Convert a PBF byte stream into a stream of JSON entities.
 *
 * Pipes raw PBF bytes through block decoding and entity parsing, yielding
 * the header block first, then individual nodes, ways, and relations as
 * typed JSON objects.
 *
 * @param pbf - ReadableStream of raw PBF bytes.
 * @returns ReadableStream yielding header block and JSON entities.
 *
 * @example
 * ```ts
 * import { osmPbfToJson } from "@osmix/json"
 * import { toAsyncGenerator } from "@osmix/pbf"
 *
 * const stream = osmPbfToJson(Bun.file('./monaco.pbf').stream())
 * for await (const item of toAsyncGenerator(stream)) {
 *   if ("id" in item) {
 *     // item is OsmNode | OsmWay | OsmRelation
 *     console.log(item.id, item.tags)
 *   } else {
 *     // item is OsmPbfHeaderBlock
 *     console.log(item.required_features)
 *   }
 * }
 * ```
 */
export function osmPbfToJson(pbf: ReadableStream<Uint8Array<ArrayBufferLike>>) {
	return pbf
		.pipeThrough(new OsmPbfBytesToBlocksTransformStream())
		.pipeThrough(new OsmBlocksToJsonTransformStream())
}

/**
 * TransformStream that converts OSM PBF blocks into JSON entities.
 *
 * Accepts header and primitive blocks from `OsmPbfBytesToBlocksTransformStream`
 * and emits the header unchanged, followed by individual JSON entities extracted
 * from each primitive group.
 *
 * @example
 * ```ts
 * const jsonStream = blocksStream.pipeThrough(new OsmBlocksToJsonTransformStream())
 * ```
 */
export class OsmBlocksToJsonTransformStream extends TransformStream<
	OsmPbfHeaderBlock | OsmPbfBlock,
	OsmPbfHeaderBlock | OsmEntity
> {
	constructor() {
		super({
			transform: async (block, controller) => {
				if ("primitivegroup" in block) {
					for (const entity of blocksToJsonEntities(block)) {
						controller.enqueue(entity)
					}
				} else {
					controller.enqueue(block)
				}
			},
		})
	}
}

/**
 * Extract JSON entities from a single primitive block.
 *
 * Iterates through all primitive groups in the block and yields parsed
 * nodes, ways, and relations with decoded tags and coordinates.
 *
 * @param block - Parsed primitive block with string table and groups.
 * @yields Individual OsmNode, OsmWay, or OsmRelation objects.
 */
export function* blocksToJsonEntities(
	block: OsmPbfBlock,
): Generator<OsmEntity> {
	const blockParser = new OsmPbfBlockParser(block)
	for (const group of blockParser.primitivegroup) {
		if (group.nodes.length > 0) {
			for (const n of group.nodes) {
				yield blockParser.parseNode(n)
			}
		}
		if (group.dense != null) {
			for (const node of blockParser.parseDenseNodes(group.dense)) {
				yield node
			}
		}
		if (group.ways.length > 0) {
			for (const w of group.ways) {
				yield blockParser.parseWay(w)
			}
		}
		if (group.relations.length > 0) {
			for (const r of group.relations) {
				yield blockParser.parseRelation(r)
			}
		}
	}
}
