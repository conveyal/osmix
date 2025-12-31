import { readOsmHeaderBlock } from "./blobs-to-blocks"
import { createOsmPbfBlobGenerator } from "./pbf-to-blobs"
import type { OsmPbfBlock, OsmPbfHeaderBlock } from "./proto/osmformat"
import { toAsyncGenerator, type AsyncGeneratorValue } from "./utils"
import type { DecodeResponse } from "./workers/decode-primitive-block.worker"

export interface ReadOsmPbfParallelOptions {
	/**
	 * Number of worker threads to use for primitive-block decompression + decoding.
	 * If `<= 1` (or if Workers are unavailable), falls back to `readOsmPbf`.
	 */
	workers?: number
	/**
	 * Bound the number of in-flight decode jobs to avoid unbounded buffering.
	 * Defaults to `workers * 2`.
	 */
	maxInflight?: number
}

function canUseWorkers(): boolean {
	return typeof Worker !== "undefined"
}

function waitAny<T>(
	map: Map<number, Promise<T>>,
): Promise<readonly [number, T]> {
	return Promise.race(
		Array.from(map.entries(), ([id, p]) => p.then((v) => [id, v] as const)),
	)
}

class PrimitiveBlockDecodePool {
	private workers: Worker[]
	private next = 0
	private pending = new Map<
		number,
		{ resolve: (b: OsmPbfBlock) => void; reject: (e: Error) => void }
	>()

	constructor(count: number) {
		this.workers = Array.from({ length: count }, () => {
			const worker = new Worker(
				new URL("./workers/decode-primitive-block.worker.ts", import.meta.url),
				{ type: "module" },
			)
			worker.addEventListener("message", (e: MessageEvent<DecodeResponse>) => {
				const msg = e.data
				const pending = this.pending.get(msg.id)
				if (!pending) return
				this.pending.delete(msg.id)
				if ("error" in msg) pending.reject(Error(msg.error))
				else pending.resolve(msg.block)
			})
			return worker
		})
	}

	decode(
		id: number,
		compressed: Uint8Array<ArrayBuffer>,
	): Promise<OsmPbfBlock> {
		const worker = this.workers[this.next++ % this.workers.length]!
		return new Promise<OsmPbfBlock>((resolve, reject) => {
			this.pending.set(id, { resolve, reject })
			// IMPORTANT: `compressed` may be a view into an internal streaming buffer.
			// Transferring that ArrayBuffer would detach it and break the streaming parser.
			// Take ownership by copying into a dedicated buffer, then transfer that.
			const owned = compressed.slice()
			worker.postMessage({ id, compressed: owned.buffer }, [owned.buffer])
		})
	}

	close() {
		for (const w of this.workers) w.terminate()
		this.pending.clear()
	}
}

/**
 * Parse an OSM PBF file using a worker pool to decode primitive blocks in parallel.
 *
 * This preserves the same output ordering as `readOsmPbf`, so downstream consumers
 * can process blocks deterministically. Falls back to `readOsmPbf` when workers
 * are unavailable.
 */
export async function readOsmPbfParallel(
	data: AsyncGeneratorValue<Uint8Array<ArrayBufferLike>>,
	options: ReadOsmPbfParallelOptions = {},
): Promise<{
	header: OsmPbfHeaderBlock
	blocks: AsyncGenerator<OsmPbfBlock>
}> {
	const workers = options.workers ?? 0
	if (!canUseWorkers() || workers <= 1) {
		const { readOsmPbf } = await import("./pbf-to-blocks")
		return readOsmPbf(data)
	}

	const maxInflight = options.maxInflight ?? workers * 2
	const generateBlobsFromChunk = createOsmPbfBlobGenerator()

	const blobs = (async function* () {
		for await (const chunk of toAsyncGenerator(data)) {
			for await (const blob of generateBlobsFromChunk(chunk)) {
				yield blob
			}
		}
	})()

	const first = await blobs.next()
	if (first.done || !first.value) throw Error("OSM PBF header block not found")
	const header = await readOsmHeaderBlock(
		first.value as Uint8Array<ArrayBuffer>,
	)

	const pool = new PrimitiveBlockDecodePool(workers)

	const blocks = (async function* () {
		let readId = 0
		let nextYield = 0
		const inflight = new Map<number, Promise<OsmPbfBlock>>()
		const resolved = new Map<number, OsmPbfBlock>()
		try {
			for await (const blob of blobs) {
				while (inflight.size >= maxInflight) {
					const [id, block] = await waitAny(inflight)
					inflight.delete(id)
					resolved.set(id, block)
					while (resolved.has(nextYield)) {
						yield resolved.get(nextYield)!
						resolved.delete(nextYield)
						nextYield++
					}
				}
				const id = readId++
				inflight.set(id, pool.decode(id, blob as Uint8Array<ArrayBuffer>))
			}

			// Drain remaining work, yielding in order.
			while (inflight.size > 0 || resolved.size > 0) {
				if (resolved.has(nextYield)) {
					yield resolved.get(nextYield)!
					resolved.delete(nextYield)
					nextYield++
					continue
				}

				const next = inflight.get(nextYield)
				if (next) {
					const block = await next
					inflight.delete(nextYield)
					yield block
					nextYield++
					continue
				}

				const [id, block] = await waitAny(inflight)
				inflight.delete(id)
				resolved.set(id, block)
			}
		} finally {
			pool.close()
		}
	})()

	return { header, blocks }
}
