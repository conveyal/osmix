import {
	type OsmPbfBlock,
	OsmPbfBytesToBlocksTransformStream,
	type OsmPbfHeaderBlock,
} from "@osmix/pbf"
import { OsmPbfBlockParser } from "./osm-pbf-block-parser"
import type { OsmEntity } from "./types"

export function osmPbfToJson(pbf: ReadableStream<Uint8Array<ArrayBufferLike>>) {
	return pbf
		.pipeThrough(new OsmPbfBytesToBlocksTransformStream())
		.pipeThrough(new OsmBlocksToJsonTransformStream())
}

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
