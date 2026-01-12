/**
 * Lazy GTFS archive parser.
 *
 * Only parses CSV files when they are accessed, not upfront.
 * Uses streaming CSV parsing for memory efficiency.
 *
 * @module
 */

import { unzip, type ZipItem } from "but-unzip"
import { parse } from "csv-parse/sync"
import type {
	GtfsAgency,
	GtfsRoute,
	GtfsShapePoint,
	GtfsStop,
	GtfsStopTime,
	GtfsTrip,
} from "./types"

/**
 * Lazy GTFS archive that only parses files on demand.
 *
 * Files are read from the zip and parsed only when their
 * corresponding getter is called for the first time.
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
	 * Parse a CSV file from the archive.
	 */
	private async parseFile<T>(filename: string): Promise<T[]> {
		const entry = this.entries.get(filename)
		if (!entry) return []

		const data = entry.read()
		const bytes = data instanceof Promise ? await data : data
		const content = new TextDecoder().decode(bytes)

		return parse(content, {
			columns: true,
			skip_empty_lines: true,
			trim: true,
		}) as T[]
	}

	/**
	 * Get agencies (parsed on first access).
	 */
	async agencies(): Promise<GtfsAgency[]> {
		if (!this._agencies) {
			this._agencies = await this.parseFile<GtfsAgency>("agency.txt")
		}
		return this._agencies
	}

	/**
	 * Get stops (parsed on first access).
	 */
	async stops(): Promise<GtfsStop[]> {
		if (!this._stops) {
			this._stops = await this.parseFile<GtfsStop>("stops.txt")
		}
		return this._stops
	}

	/**
	 * Get routes (parsed on first access).
	 */
	async routes(): Promise<GtfsRoute[]> {
		if (!this._routes) {
			this._routes = await this.parseFile<GtfsRoute>("routes.txt")
		}
		return this._routes
	}

	/**
	 * Get trips (parsed on first access).
	 */
	async trips(): Promise<GtfsTrip[]> {
		if (!this._trips) {
			this._trips = await this.parseFile<GtfsTrip>("trips.txt")
		}
		return this._trips
	}

	/**
	 * Get stop times (parsed on first access).
	 */
	async stopTimes(): Promise<GtfsStopTime[]> {
		if (!this._stopTimes) {
			this._stopTimes = await this.parseFile<GtfsStopTime>("stop_times.txt")
		}
		return this._stopTimes
	}

	/**
	 * Get shapes (parsed on first access).
	 */
	async shapes(): Promise<GtfsShapePoint[]> {
		if (!this._shapes) {
			this._shapes = await this.parseFile<GtfsShapePoint>("shapes.txt")
		}
		return this._shapes
	}

	/**
	 * Iterate over stops without loading all into memory.
	 * Parses the CSV row by row.
	 */
	async *iterStops(): AsyncGenerator<GtfsStop> {
		const entry = this.entries.get("stops.txt")
		if (!entry) return

		const data = entry.read()
		const bytes = data instanceof Promise ? await data : data
		const content = new TextDecoder().decode(bytes)

		const records = parse(content, {
			columns: true,
			skip_empty_lines: true,
			trim: true,
		}) as GtfsStop[]

		for (const record of records) {
			yield record
		}
	}

	/**
	 * Iterate over routes without loading all into memory.
	 */
	async *iterRoutes(): AsyncGenerator<GtfsRoute> {
		const entry = this.entries.get("routes.txt")
		if (!entry) return

		const data = entry.read()
		const bytes = data instanceof Promise ? await data : data
		const content = new TextDecoder().decode(bytes)

		const records = parse(content, {
			columns: true,
			skip_empty_lines: true,
			trim: true,
		}) as GtfsRoute[]

		for (const record of records) {
			yield record
		}
	}

	/**
	 * Iterate over shapes without loading all into memory.
	 */
	async *iterShapes(): AsyncGenerator<GtfsShapePoint> {
		const entry = this.entries.get("shapes.txt")
		if (!entry) return

		const data = entry.read()
		const bytes = data instanceof Promise ? await data : data
		const content = new TextDecoder().decode(bytes)

		const records = parse(content, {
			columns: true,
			skip_empty_lines: true,
			trim: true,
		}) as GtfsShapePoint[]

		for (const record of records) {
			yield record
		}
	}

	/**
	 * Iterate over trips without loading all into memory.
	 */
	async *iterTrips(): AsyncGenerator<GtfsTrip> {
		const entry = this.entries.get("trips.txt")
		if (!entry) return

		const data = entry.read()
		const bytes = data instanceof Promise ? await data : data
		const content = new TextDecoder().decode(bytes)

		const records = parse(content, {
			columns: true,
			skip_empty_lines: true,
			trim: true,
		}) as GtfsTrip[]

		for (const record of records) {
			yield record
		}
	}

	/**
	 * Iterate over stop times without loading all into memory.
	 */
	async *iterStopTimes(): AsyncGenerator<GtfsStopTime> {
		const entry = this.entries.get("stop_times.txt")
		if (!entry) return

		const data = entry.read()
		const bytes = data instanceof Promise ? await data : data
		const content = new TextDecoder().decode(bytes)

		const records = parse(content, {
			columns: true,
			skip_empty_lines: true,
			trim: true,
		}) as GtfsStopTime[]

		for (const record of records) {
			yield record
		}
	}
}
