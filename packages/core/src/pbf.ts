import {
	type OsmEntity,
	type OsmEntityType,
	type OsmEntityTypeMap,
	OsmJsonToBlocksTransformStream,
	type OsmNode,
	type OsmRelation,
	type OsmWay,
} from "@osmix/json"
import {
	type AsyncGeneratorValue,
	OsmBlocksToPbfBytesTransformStream,
	type OsmPbfHeaderBlock,
	readOsmPbf,
} from "@osmix/pbf"
import {
	logProgress,
	type ProgressEvent,
	progressEvent,
} from "@osmix/shared/progress"
import type { GeoBbox2D } from "@osmix/shared/types"
import { Osm, type OsmOptions } from "./osm"

export interface OsmFromPbfOptions extends OsmOptions {
	extractBbox: GeoBbox2D
	filter<T extends OsmEntityType>(
		type: T,
		entity: OsmEntityTypeMap[T],
		osmix: Osm,
	): boolean
	buildSpatialIndexes: OsmEntityType[]

	// Future options
	// include: OsmEntityType[]
}

/**
 * Create a new Osm index from a PBF stream or array buffer.
 */
export async function createOsmFromPbf(
	data: AsyncGeneratorValue<Uint8Array<ArrayBufferLike>>,
	options: Partial<OsmFromPbfOptions> = {},
	onProgress: (progress: ProgressEvent) => void = logProgress,
): Promise<Osm> {
	const osm = new Osm(options)
	for await (const update of startCreateOsmFromPbf(osm, data, options)) {
		onProgress(update)
	}
	return osm
}

/**
 * Parse raw PBF data into an Osm index.
 */
export async function* startCreateOsmFromPbf(
	osm: Osm,
	data: AsyncGeneratorValue<Uint8Array<ArrayBufferLike>>,
	options: Partial<OsmFromPbfOptions> = {},
): AsyncGenerator<ProgressEvent> {
	const { extractBbox } = options
	const { header, blocks } = await readOsmPbf(data)
	osm.header = header
	if (extractBbox) {
		osm.header.bbox = {
			left: extractBbox[0],
			bottom: extractBbox[1],
			right: extractBbox[2],
			top: extractBbox[3],
		}
	}

	let blockIndex = 0
	for await (const block of blocks) {
		const blockStringIndexMap = osm.stringTable.createBlockIndexMap(block)

		for (const group of block.primitivegroup) {
			const { nodes, ways, relations, dense } = group
			if (nodes && nodes.length > 0) {
				throw Error("Nodes must be dense!")
			}

			if (dense) {
				osm.nodes.addDenseNodes(
					dense,
					block,
					blockStringIndexMap,
					extractBbox
						? (node: OsmNode) => {
								return (
									node.lon >= extractBbox[0] &&
									node.lon <= extractBbox[2] &&
									node.lat >= extractBbox[1] &&
									node.lat <= extractBbox[3]
								)
							}
						: undefined,
				)
			}

			if (ways.length > 0) {
				// Nodes are finished, build their index.
				if (!osm.nodes.isReady()) osm.nodes.buildIndex()
				osm.ways.addWays(
					ways,
					blockStringIndexMap,
					extractBbox
						? (way: OsmWay) => {
								const refs = way.refs.filter((ref) => osm.nodes.ids.has(ref))
								if (refs.length === 0) return null
								return {
									...way,
									refs,
								}
							}
						: undefined,
				)
			}

			if (relations.length > 0) {
				if (!osm.ways.isReady()) osm.ways.buildIndex()
				osm.relations.addRelations(
					relations,
					blockStringIndexMap,
					extractBbox
						? (relation: OsmRelation) => {
								const members = relation.members.filter((member) => {
									if (member.type === "node")
										return osm.nodes.ids.has(member.ref)
									if (member.type === "way") return osm.ways.ids.has(member.ref)
									return false
								})
								if (members.length === 0) return null
								return {
									...relation,
									members,
								}
							}
						: undefined,
				)
			}
		}

		yield progressEvent(`Block ${++blockIndex} processed`)
	}

	yield progressEvent(
		`${osm.nodes.size.toLocaleString()} nodes, ${osm.ways.size.toLocaleString()} ways, and ${osm.relations.size.toLocaleString()} relations added.`,
	)
	yield progressEvent("Building remaining id and tag indexes...")
	osm.buildIndexes()

	// By default, build all spatial indexes.
	if (!Array.isArray(options.buildSpatialIndexes)) {
		osm.buildSpatialIndexes()
	} else if (options.buildSpatialIndexes.includes("node")) {
		osm.nodes.buildSpatialIndex()
	} else if (options.buildSpatialIndexes.includes("way")) {
		osm.ways.buildSpatialIndex()
	}
}

/**
 * Create a generator that yields all entities in the OSM index, sorted by type and id.
 */
function* getAllEntitiesSorted(osm: Osm): Generator<OsmEntity> {
	for (const node of osm.nodes.sorted()) {
		yield node
	}
	for (const way of osm.ways.sorted()) {
		yield way
	}
	for (const relation of osm.relations.sorted()) {
		yield relation
	}
}

/**
 * Convert the OSM index to a `ReadableStream<OsmPbfHeaderBlock | OsmEntity>`.
 */
export function createReadableEntityStreamFromOsm(
	osm: Osm,
): ReadableStream<OsmPbfHeaderBlock | OsmEntity> {
	let headerEnqueued = false
	const entityGenerator = getAllEntitiesSorted(osm)
	return new ReadableStream<OsmPbfHeaderBlock | OsmEntity>({
		pull: async (controller) => {
			if (!headerEnqueued) {
				controller.enqueue({
					...osm.header,
					writingprogram: "@osmix/core",
					osmosis_replication_timestamp: Date.now(),
				})
				headerEnqueued = true
			}
			const block = entityGenerator.next()
			if (block.done) {
				controller.close()
			} else {
				controller.enqueue(block.value)
			}
		},
	})
}

/**
 * Convert the OSM index to a `ReadableStream<Uint8Array>` of PBF bytes.
 */
export function osmToPbfStream(osm: Osm): ReadableStream<Uint8Array> {
	return createReadableEntityStreamFromOsm(osm)
		.pipeThrough(new OsmJsonToBlocksTransformStream())
		.pipeThrough(new OsmBlocksToPbfBytesTransformStream())
}

/**
 * Convert the OSM index to an in memory PBF ArrayBuffer.
 */
export async function osmToPbfBuffer(osm: Osm): Promise<ArrayBuffer> {
	const chunks: Uint8Array[] = []
	let byteLength = 0
	const writable = new WritableStream<Uint8Array>({
		write(chunk) {
			chunks.push(chunk)
			byteLength += chunk.byteLength
		},
	})
	await osmToPbfStream(osm).pipeTo(writable)
	const combined = new Uint8Array(byteLength)
	let offset = 0
	for (const chunk of chunks) {
		combined.set(chunk, offset)
		offset += chunk.byteLength
	}
	return combined.buffer
}
