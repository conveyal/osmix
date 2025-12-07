import type { Osm } from "@osmix/core"
import type { OsmPbfHeaderBlock } from "@osmix/pbf"
import type { OsmEntity } from "@osmix/shared/types"
import { transfer as comlinkTransfer } from "comlink"

export type Transferables = ArrayBufferLike | ReadableStream

/**
 * Recursively collect all transferable values from a nested object.
 * Searches for ArrayBuffers, TypedArray buffers, and ReadableStreams.
 * Used to prepare data for zero-copy transfer to or from workers.
 */
export function collectTransferables(value: unknown): Transferables[] {
	const transferables: Transferables[] = []

	if (value instanceof ArrayBuffer) transferables.push(value)
	else if (value instanceof ReadableStream) transferables.push(value)
	else if (ArrayBuffer.isView(value)) transferables.push(value.buffer)
	else if (Array.isArray(value)) {
		for (const item of value) {
			transferables.push(...collectTransferables(item))
		}
	} else if (value && typeof value === "object") {
		for (const item of Object.values(value)) {
			transferables.push(...collectTransferables(item))
		}
	}

	return transferables
}

/**
 * Wrap data with Comlink.transfer, automatically collecting transferable buffers.
 * Enables zero-copy message passing for typed arrays and streams.
 */
export function transfer<T>(data: T) {
	return comlinkTransfer(data, collectTransferables(data))
}

/**
 * Feature-detect whether the browser supports transferable ReadableStreams.
 * Attempts to post a stream through a MessageChannel; throws DataCloneError if unsupported.
 */
export function supportsReadableStreamTransfer(): boolean {
	// Require the basics first
	if (
		typeof ReadableStream === "undefined" ||
		typeof MessageChannel === "undefined"
	)
		return false

	const { port1 } = new MessageChannel()
	try {
		const rs = new ReadableStream() // empty is fine for feature test
		// If transferable streams are unsupported, this line throws a DataCloneError
		port1.postMessage(rs, [rs])
		return true
	} catch {
		return false
	} finally {
		port1.close()
	}
}

/**
 * Create a generator that yields all entities in the `Osm` index, sorted by type and ID.
 * Order: nodes first, then ways, then relations, each sorted by ID.
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
 * Convert the `Osm` index to a `ReadableStream` of header and entity objects.
 * Header is emitted first, followed by all entities in sorted order.
 * Stream can be piped through transform streams for further processing.
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
