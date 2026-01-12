/**
 * Lazy GTFS archive parser with streaming CSV support.
 *
 * Only parses CSV files when they are accessed, not upfront.
 * Uses @std/csv CsvParseStream for true line-by-line streaming.
 *
 * @module
 */

import { CsvParseStream } from "@std/csv/parse-stream"
import { unzip, type ZipItem } from "but-unzip"
import type {
	GtfsAgency,
	GtfsRoute,
	GtfsShapePoint,
	GtfsStop,
	GtfsStopTime,
	GtfsTrip,
} from "./types"

/**
 * Map of GTFS filenames to their record types.
 */
export interface GtfsFileTypeMap {
	"agency.txt": GtfsAgency
	"stops.txt": GtfsStop
	"routes.txt": GtfsRoute
	"trips.txt": GtfsTrip
	"stop_times.txt": GtfsStopTime
	"shapes.txt": GtfsShapePoint
}

/** Valid GTFS filenames that can be parsed. */
export type GtfsFileName = keyof GtfsFileTypeMap

/**
 * Lazy GTFS archive that only parses files on demand.
 *
 * Files are read from the zip and parsed only when their
 * corresponding getter is called for the first time.
 * Streaming iterators parse CSV line-by-line without loading
 * the entire file into memory.
 */
export class GtfsArchive {
	private entries: Map<string, ZipItem>

	// Cached parsed data (lazily populated)
	private _agencies?: GtfsAgency[]
	private _stops?: GtfsStop[]
	private _routes?: GtfsRoute[]
	private _trips?: GtfsTrip[]
	private _stopTimes?: GtfsStopTime[]
	private _shapes?: GtfsShapePoint[]

	private constructor(entries: Map<string, ZipItem>) {
		this.entries = entries
	}

	/**
	 * Create a GtfsArchive from zip data.
	 */
	static fromZip(zipData: ArrayBuffer | Uint8Array): GtfsArchive {
		const bytes =
			zipData instanceof Uint8Array ? zipData : new Uint8Array(zipData)
		const items = unzip(bytes)

		const entries = new Map<string, ZipItem>()
		for (const item of items) {
			// Remove directory prefix and store by filename
			const name = item.filename.replace(/^.*\//, "")
			if (name.endsWith(".txt")) {
				entries.set(name, item)
			}
		}

		return new GtfsArchive(entries)
	}

	/**
	 * Check if a file exists in the archive.
	 */
	hasFile(filename: string): boolean {
		return this.entries.has(filename)
	}

	/**
	 * List all files in the archive.
	 */
	listFiles(): string[] {
		return Array.from(this.entries.keys())
	}

	/**
	 * Get a readable stream of bytes for a file.
	 */
	private async getFileBytes(filename: string): Promise<Uint8Array | null> {
		const entry = this.entries.get(filename)
		if (!entry) return null

		const data = entry.read()
		return data instanceof Promise ? await data : data
	}

	/**
	 * Stream parse a CSV file, yielding typed records one at a time.
	 *
	 * The return type is automatically inferred based on the filename:
	 * - `"stops.txt"` → `AsyncGenerator<GtfsStop>`
	 * - `"routes.txt"` → `AsyncGenerator<GtfsRoute>`
	 * - `"shapes.txt"` → `AsyncGenerator<GtfsShapePoint>`
	 * - etc.
	 *
	 * @param filename - The GTFS filename to parse (e.g., "stops.txt")
	 * @returns An async generator yielding typed records
	 *
	 * @example
	 * ```ts
	 * for await (const stop of archive.iter("stops.txt")) {
	 *   console.log(stop.stop_name) // TypeScript knows this is GtfsStop
	 * }
	 * ```
	 */
	async *iter<F extends GtfsFileName>(
		filename: F,
	): AsyncGenerator<GtfsFileTypeMap[F], void, unknown> {
		const bytes = await this.getFileBytes(filename)
		if (!bytes) return

		const textStream = bytesToTextStream(bytes)
		const csvStream = textStream.pipeThrough(
			new CsvParseStream({ skipFirstRow: true }),
		)

		const reader = csvStream.getReader()
		try {
			while (true) {
				const { value, done } = await reader.read()
				if (done) break
				yield value as unknown as GtfsFileTypeMap[F]
			}
		} finally {
			reader.releaseLock()
		}
	}

	/**
	 * Parse an entire CSV file into an array (caches result).
	 */
	private async parseFile<F extends GtfsFileName>(
		filename: F,
	): Promise<GtfsFileTypeMap[F][]> {
		const results: GtfsFileTypeMap[F][] = []
		for await (const record of this.iter(filename)) {
			results.push(record)
		}
		return results
	}

	/**
	 * Get agencies (parsed on first access, cached).
	 */
	async agencies(): Promise<GtfsAgency[]> {
		if (!this._agencies) {
			this._agencies = await this.parseFile("agency.txt")
		}
		return this._agencies
	}

	/**
	 * Get stops (parsed on first access, cached).
	 */
	async stops(): Promise<GtfsStop[]> {
		if (!this._stops) {
			this._stops = await this.parseFile("stops.txt")
		}
		return this._stops
	}

	/**
	 * Get routes (parsed on first access, cached).
	 */
	async routes(): Promise<GtfsRoute[]> {
		if (!this._routes) {
			this._routes = await this.parseFile("routes.txt")
		}
		return this._routes
	}

	/**
	 * Get trips (parsed on first access, cached).
	 */
	async trips(): Promise<GtfsTrip[]> {
		if (!this._trips) {
			this._trips = await this.parseFile("trips.txt")
		}
		return this._trips
	}

	/**
	 * Get stop times (parsed on first access, cached).
	 */
	async stopTimes(): Promise<GtfsStopTime[]> {
		if (!this._stopTimes) {
			this._stopTimes = await this.parseFile("stop_times.txt")
		}
		return this._stopTimes
	}

	/**
	 * Get shapes (parsed on first access, cached).
	 */
	async shapes(): Promise<GtfsShapePoint[]> {
		if (!this._shapes) {
			this._shapes = await this.parseFile("shapes.txt")
		}
		return this._shapes
	}

	/**
	 * Stream stops line by line without loading all into memory.
	 * @deprecated Use `iter("stops.txt")` instead
	 */
	async *iterStops(): AsyncGenerator<GtfsStop, void, unknown> {
		yield* this.iter("stops.txt")
	}

	/**
	 * Stream routes line by line without loading all into memory.
	 * @deprecated Use `iter("routes.txt")` instead
	 */
	async *iterRoutes(): AsyncGenerator<GtfsRoute, void, unknown> {
		yield* this.iter("routes.txt")
	}

	/**
	 * Stream shapes line by line without loading all into memory.
	 * @deprecated Use `iter("shapes.txt")` instead
	 */
	async *iterShapes(): AsyncGenerator<GtfsShapePoint, void, unknown> {
		yield* this.iter("shapes.txt")
	}

	/**
	 * Stream trips line by line without loading all into memory.
	 * @deprecated Use `iter("trips.txt")` instead
	 */
	async *iterTrips(): AsyncGenerator<GtfsTrip, void, unknown> {
		yield* this.iter("trips.txt")
	}

	/**
	 * Stream stop times line by line without loading all into memory.
	 * @deprecated Use `iter("stop_times.txt")` instead
	 */
	async *iterStopTimes(): AsyncGenerator<GtfsStopTime, void, unknown> {
		yield* this.iter("stop_times.txt")
	}

	/**
	 * Stream agencies line by line without loading all into memory.
	 * @deprecated Use `iter("agency.txt")` instead
	 */
	async *iterAgencies(): AsyncGenerator<GtfsAgency, void, unknown> {
		yield* this.iter("agency.txt")
	}
}

/**
 * Create a ReadableStream of text from file bytes.
 */
function bytesToTextStream(bytes: Uint8Array): ReadableStream<string> {
	const decoder = new TextDecoder()
	let offset = 0
	const chunkSize = 64 * 1024 // 64KB chunks

	return new ReadableStream<string>({
		pull(controller) {
			if (offset >= bytes.length) {
				controller.close()
				return
			}

			const end = Math.min(offset + chunkSize, bytes.length)
			const chunk = bytes.subarray(offset, end)
			offset = end

			controller.enqueue(
				decoder.decode(chunk, { stream: offset < bytes.length }),
			)
		},
	})
}
