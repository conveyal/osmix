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
import { bytesToTextStream } from "./utils"

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
}
