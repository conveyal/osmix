/**
 * PBF loading and serialization utilities.
 *
 * Provides functions for loading OSM PBF data into Osm indexes and
 * serializing Osm indexes back to PBF format. Supports streaming
 * for memory-efficient processing of large datasets.
 *
 * @module
 */

import { Osm, type OsmOptions } from "@osmix/core/src/osm"
import {
	OsmBlocksToJsonTransformStream,
	OsmJsonToBlocksTransformStream,
} from "@osmix/json"
import {
	type AsyncGeneratorValue,
	OsmBlocksToPbfBytesTransformStream,
	OsmPbfBytesToBlocksTransformStream,
	readOsmPbf,
	readOsmPbfParallel,
} from "@osmix/pbf"
import {
	logProgress,
	type ProgressEvent,
	type Progress,
	progressEvent,
} from "@osmix/shared/progress"
import type {
	GeoBbox2D,
	OsmEntityType,
	OsmEntityTypeMap,
	OsmNode,
	OsmRelation,
	OsmWay,
} from "@osmix/shared/types"
import { createReadableEntityStreamFromOsm } from "./utils"

/**
 * Options for loading OSM data from PBF.
 */
export interface OsmFromPbfOptions extends OsmOptions {
	extractBbox: GeoBbox2D
	/**
	 * Decode primitive PBF blocks in parallel using a worker pool.
	 *
	 * This speeds up decompression + protobuf decoding, while keeping entity ingestion
	 * deterministic. Set to `1` (default) to disable.
	 */
	parseConcurrency?: number
	/**
	 * Run entity ingestion (and index building) in a dedicated Worker.
	 *
	 * Notes:
	 * - This is primarily for moving heavy ingestion work off the main thread.
	 * - `filter` functions cannot be sent to workers; if `filter` is provided, this
	 *   option is ignored and ingestion happens on the current thread.
	 */
	ingestInWorker?: boolean
	filter<T extends OsmEntityType>(
		type: T,
		entity: OsmEntityTypeMap[T],
		osmix: Osm,
	): boolean
	buildSpatialIndexes: OsmEntityType[]
}

/**
 * Read only the header block from PBF data without parsing entities.
 * Useful for previewing metadata before loading the entire dataset.
 */
export async function readOsmPbfHeader(data: Parameters<typeof readOsmPbf>[0]) {
	const { header } = await readOsmPbf(data)
	return header
}

/**
 * Create a new Osm index from PBF data (stream or buffer).
 * Parses all OSM entities, builds ID and tag indexes, and constructs spatial indexes.
 * Supports optional bbox extraction and entity filtering during ingestion.
 */
export async function fromPbf(
	data: AsyncGeneratorValue<Uint8Array<ArrayBufferLike>>,
	options: Partial<OsmFromPbfOptions> = {},
	onProgress: (progress: ProgressEvent) => void = logProgress,
): Promise<Osm> {
	// If a user passes a filter function, we must ingest locally (functions aren't transferable).
	const hasFilter = typeof options.filter === "function"
	if (options.ingestInWorker && !hasFilter && typeof Worker !== "undefined") {
		const bytes = await toUint8Array(data)
		return fromPbfInWorker(bytes, options, onProgress)
	}

	const createOsm = startCreateOsmFromPbf(data, options)
	do {
		const { value, done } = await createOsm.next()
		if (done) return value
		onProgress(value)
	} while (true)
}

async function toUint8Array(
	data: AsyncGeneratorValue<Uint8Array<ArrayBufferLike>>,
): Promise<Uint8Array<ArrayBufferLike>> {
	// Common fast-path: already a Uint8Array
	if (data instanceof Uint8Array) return data
	// Fall back to reading through @osmix/pbf's async normalization
	const { toAsyncGenerator } = await import("@osmix/pbf")
	const chunks: Uint8Array[] = []
	let total = 0
	for await (const chunk of toAsyncGenerator(data)) {
		const u8 = chunk instanceof Uint8Array ? chunk : new Uint8Array(chunk)
		chunks.push(u8)
		total += u8.byteLength
	}
	const out = new Uint8Array(total) as Uint8Array<ArrayBufferLike>
	let offset = 0
	for (const c of chunks) {
		out.set(c, offset)
		offset += c.byteLength
	}
	return out
}

async function fromPbfInWorker(
	data: Uint8Array<ArrayBufferLike>,
	options: Partial<OsmFromPbfOptions>,
	onProgress: (progress: ProgressEvent) => void,
): Promise<Osm> {
	return new Promise<Osm>((resolve, reject) => {
		const worker = new Worker(
			new URL("./workers/from-pbf.worker.ts", import.meta.url),
			{ type: "module" },
		)

		const cleanup = () => {
			worker.removeEventListener("message", onMessage)
			worker.removeEventListener("error", onError)
			worker.terminate()
		}

		const onError = (e: ErrorEvent) => {
			cleanup()
			reject(e.error ?? Error(e.message))
		}

		const onMessage = (e: MessageEvent) => {
			const msg = e.data as
				| { type: "progress"; value: Progress }
				| { type: "result"; value: ReturnType<Osm["transferables"]> }
				| { type: "error"; value: { message: string; stack?: string } }
			if (msg.type === "progress") {
				onProgress(
					new CustomEvent("progress", { detail: msg.value }) as ProgressEvent,
				)
				return
			}
			if (msg.type === "result") {
				cleanup()
				const osm = new Osm(msg.value)
				// Build spatial indexes on the main thread to avoid sending spatial-index
				// buffers through postMessage (some runtimes can't clone them reliably).
				onProgress(progressEvent("Building spatial indexes..."))
				if (!Array.isArray(options.buildSpatialIndexes)) {
					osm.buildSpatialIndexes()
				} else if (options.buildSpatialIndexes.includes("node")) {
					osm.nodes.buildSpatialIndex()
				} else if (options.buildSpatialIndexes.includes("way")) {
					osm.ways.buildSpatialIndex()
				} else if (options.buildSpatialIndexes.includes("relation")) {
					osm.relations.buildSpatialIndex()
				}
				resolve(osm)
				return
			}
			if (msg.type === "error") {
				cleanup()
				const err = Error(msg.value.message)
				if (msg.value.stack) err.stack = msg.value.stack
				reject(err)
			}
		}

		worker.addEventListener("message", onMessage)
		worker.addEventListener("error", onError)

		// Send bytes + options.
		// - Do not transfer the buffer: the caller might reuse `data`.
		// - Force spatial index building to happen on the main thread (see above).
		const workerOptions: Partial<OsmFromPbfOptions> = {
			...options,
			ingestInWorker: false,
			buildSpatialIndexes: [],
		}
		worker.postMessage({
			data: data.slice(0),
			options: workerOptions,
		})
	})
}

/**
 * Parse raw PBF data into an Osm index.
 * Yields progress events during parsing and index building.
 * Returns the completed Osm instance when done.
 */
export async function* startCreateOsmFromPbf(
	data: AsyncGeneratorValue<Uint8Array<ArrayBufferLike>>,
	options: Partial<OsmFromPbfOptions> = {},
): AsyncGenerator<ProgressEvent, Osm> {
	const { extractBbox } = options
	const parseConcurrency = options.parseConcurrency ?? 1
	const { header, blocks } =
		parseConcurrency > 1
			? await readOsmPbfParallel(data, { workers: parseConcurrency })
			: await readOsmPbf(data)
	const osm = new Osm({
		...options,
		header,
	})
	if (extractBbox) {
		osm.header.bbox = {
			left: extractBbox[0],
			bottom: extractBbox[1],
			right: extractBbox[2],
			top: extractBbox[3],
		}
	}

	let blockCount = 0
	for await (const block of blocks) {
		const blockStringIndexMap = osm.stringTable.createBlockIndexMap(
			block.stringtable,
		)

		for (const group of block.primitivegroup) {
			const { nodes, ways, relations, dense } = group
			if (nodes && nodes.length > 0) throw Error("Nodes must be dense!")

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

		blockCount++
		yield progressEvent(
			`Processed ${blockCount.toLocaleString()} blocks, ${osm.nodes.size.toLocaleString()} nodes, ${osm.ways.size.toLocaleString()} ways, and ${osm.relations.size.toLocaleString()} relations added.`,
		)
	}

	yield progressEvent(
		`${osm.nodes.size.toLocaleString()} nodes, ${osm.ways.size.toLocaleString()} ways, and ${osm.relations.size.toLocaleString()} relations added.`,
	)
	yield progressEvent("Building ID and tag indexes...")
	osm.buildIndexes()

	// By default, build all spatial indexes.
	if (!Array.isArray(options.buildSpatialIndexes)) {
		yield progressEvent("Building all spatial indexes...")
		osm.buildSpatialIndexes()
	} else if (options.buildSpatialIndexes.includes("node")) {
		yield progressEvent("Building node spatial index...")
		osm.nodes.buildSpatialIndex()
	} else if (options.buildSpatialIndexes.includes("way")) {
		yield progressEvent("Building way spatial index...")
		osm.ways.buildSpatialIndex()
	} else if (options.buildSpatialIndexes.includes("relation")) {
		yield progressEvent("Building relation spatial index...")
		osm.relations.buildSpatialIndex()
	}

	yield progressEvent(`Finished loading ${osm.id} PBF data into Osmix.`)

	return osm
}

/**
 * Convert the OSM index to a ReadableStream of PBF-encoded bytes.
 * Entities are streamed, transformed into PBF blocks, and encoded on the fly.
 * Suitable for piping to file or network streams.
 */
export function toPbfStream(osm: Osm): ReadableStream<Uint8Array> {
	return createReadableEntityStreamFromOsm(osm)
		.pipeThrough(new OsmJsonToBlocksTransformStream())
		.pipeThrough(new OsmBlocksToPbfBytesTransformStream())
}

/**
 * Convert the OSM index to a single in-memory PBF buffer.
 * Collects all streamed chunks into a contiguous Uint8Array.
 * For large datasets, prefer osmToPbfStream to avoid memory pressure.
 */
export async function toPbfBuffer(osm: Osm): Promise<Uint8Array> {
	const chunks: Uint8Array[] = []
	let byteLength = 0
	const writable = new WritableStream<Uint8Array>({
		write(chunk) {
			chunks.push(chunk)
			byteLength += chunk.byteLength
		},
	})
	await toPbfStream(osm).pipeTo(writable)
	const combined = new Uint8Array(byteLength)
	let offset = 0
	for (const chunk of chunks) {
		combined.set(chunk, offset)
		offset += chunk.byteLength
	}
	return combined
}

/**
 * Transform OSM PBF data into a stream of JSON entities.
 */
export function transformOsmPbfToJson(data: ArrayBufferLike | ReadableStream) {
	const dataStream =
		data instanceof ReadableStream
			? data
			: new ReadableStream({
					start: (controller) => {
						controller.enqueue(new Uint8Array(data))
						controller.close()
					},
				})
	return dataStream
		.pipeThrough(new OsmPbfBytesToBlocksTransformStream())
		.pipeThrough(new OsmBlocksToJsonTransformStream())
}
