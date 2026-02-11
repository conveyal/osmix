/**
 * Browser-friendly streaming CSV parser.
 *
 * Adapted from mafintosh/csv-parser's parsing approach,
 * but implemented with Web Streams for modern runtimes.
 *
 * @module
 */

export interface CsvParseStreamOptions {
	separator?: string
	quote?: string
	escape?: string
	headers?: Array<string | null> | false | null
	skipFirstRow?: boolean
	skipComments?: boolean | string
	skipLines?: number
	strict?: boolean
	mapHeaders?: (args: { header: string; index: number }) => string | null
	mapValues?: (args: {
		header: string | undefined
		index: number
		value: string
	}) => string
}

const defaults: Required<
	Pick<
		CsvParseStreamOptions,
		| "separator"
		| "quote"
		| "escape"
		| "skipFirstRow"
		| "skipComments"
		| "strict"
	>
> = {
	separator: ",",
	quote: '"',
	escape: '"',
	skipFirstRow: false,
	skipComments: false,
	strict: false,
}

/**
 * TransformStream-like wrapper for CSV parsing.
 *
 * Exposes `writable` + `readable` so it can be used directly in `pipeThrough`.
 */
export class CsvParseStream {
	readonly readable: ReadableStream<Record<string, string>>
	readonly writable: WritableStream<string>

	constructor(opts: CsvParseStreamOptions = {}) {
		const options: Required<CsvParseStreamOptions> = {
			...defaults,
			...opts,
			headers: opts.headers ?? null,
			skipLines: opts.skipLines ?? 0,
			mapHeaders: opts.mapHeaders ?? (({ header }) => header),
			mapValues: opts.mapValues ?? (({ value }) => value),
		}

		let headers = options.headers
		let lineNumber = 0
		let row: string[] = []
		let field = ""
		let inQuotes = false

		const stream = new TransformStream<string, Record<string, string>>({
			transform(chunk, controller) {
				const emitRow = (cells: string[]) => {
					const skip = options.skipLines > lineNumber
					lineNumber++
					if (skip) return

					if (options.skipComments) {
						const commentPrefix =
							typeof options.skipComments === "string"
								? options.skipComments
								: "#"
						const firstCell = cells[0] ?? ""
						if (firstCell.startsWith(commentPrefix)) return
					}

					if (headers === null || (lineNumber === 1 && options.skipFirstRow)) {
						headers = cells.map((header, index) =>
							options.mapHeaders({ header, index }),
						)
						return
					}

					if (headers === false) {
						const out = Object.fromEntries(
							cells.map((value, index) => [index, value]),
						)
						controller.enqueue(out as unknown as Record<string, string>)
						return
					}

					if (options.strict && cells.length !== headers.length) {
						throw new RangeError(
							`Row length ${cells.length} does not match header length ${headers.length}`,
						)
					}

					const out: Record<string, string> = {}
					for (let index = 0; index < cells.length; index++) {
						const header = headers[index] ?? `_${index}`
						if (header === null) continue
						out[header] = options.mapValues({
							header,
							index,
							value: cells[index] ?? "",
						})
					}

					controller.enqueue(out)
				}

				for (let i = 0; i < chunk.length; i++) {
					const ch = chunk[i]
					const next = chunk[i + 1]

					if (ch === options.escape && inQuotes && next === options.quote) {
						field += options.quote
						i++
						continue
					}

					if (ch === options.quote) {
						inQuotes = !inQuotes
						continue
					}

					if (!inQuotes && ch === options.separator) {
						row.push(field)
						field = ""
						continue
					}

					if (!inQuotes && (ch === "\n" || ch === "\r")) {
						if (ch === "\r" && next === "\n") i++
						row.push(field)
						field = ""
						emitRow(row)
						row = []
						continue
					}

					field += ch
				}
			},
			flush(controller) {
				const emitRow = (cells: string[]) => {
					const skip = options.skipLines > lineNumber
					lineNumber++
					if (skip) return

					if (options.skipComments) {
						const commentPrefix =
							typeof options.skipComments === "string"
								? options.skipComments
								: "#"
						const firstCell = cells[0] ?? ""
						if (firstCell.startsWith(commentPrefix)) return
					}

					if (headers === null || (lineNumber === 1 && options.skipFirstRow)) {
						headers = cells.map((header, index) =>
							options.mapHeaders({ header, index }),
						)
						return
					}

					if (headers === false) {
						const out = Object.fromEntries(
							cells.map((value, index) => [index, value]),
						)
						controller.enqueue(out as unknown as Record<string, string>)
						return
					}

					if (options.strict && cells.length !== headers.length) {
						throw new RangeError(
							`Row length ${cells.length} does not match header length ${headers.length}`,
						)
					}

					const out: Record<string, string> = {}
					for (let index = 0; index < cells.length; index++) {
						const header = headers[index] ?? `_${index}`
						if (header === null) continue
						out[header] = options.mapValues({
							header,
							index,
							value: cells[index] ?? "",
						})
					}

					controller.enqueue(out)
				}

				if (field.length > 0 || row.length > 0) {
					row.push(field)
					emitRow(row)
				}
			},
		})

		this.readable = stream.readable
		this.writable = stream.writable
	}
}
