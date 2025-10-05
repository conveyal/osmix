import { APPID } from "./settings"

export function flattenValue(value: unknown): string {
	if (typeof value === "string") {
		return value
	}
	if (typeof value === "number") {
		return value.toLocaleString()
	}
	if (typeof value === "boolean") {
		return value.toString()
	}
	if (Array.isArray(value)) {
		return value.map((v) => flattenValue(v)).join(",")
	}
	if (typeof value === "object" && value !== null) {
		return Object.entries(value)
			.map(([key, value]) => {
				return `${key}=${flattenValue(value)}`
			})
			.join(",")
	}
	return ""
}
export function objectToHtmlTableString(
	object?: Record<string, string | number | boolean | unknown>,
) {
	if (object == null) return ""
	return Object.entries(object)
		.filter(([_key, value]) => {
			return typeof value !== "undefined"
		})
		.map(([key, value]) => {
			const valueString =
				key.includes("timestamp") && typeof value === "number"
					? new Date(value).toLocaleString()
					: flattenValue(value)
			return `<tr><td>${key}</td><td>${valueString}</td></tr>`
		})
		.join("")
}

export function layerIdToName(id: string) {
	if (id === `${APPID}:patch-geojson`) return "Patch"
	if (id === `${APPID}:base-geojson`) return "Base"
	if (id === `${APPID}:patch-way-geojson`) return "Current Way"
	return id
}

const formatMmSsMs = new Intl.DateTimeFormat("en-US", {
	hour: "2-digit",
	minute: "2-digit",
	second: "2-digit",
	fractionalSecondDigits: 3,
	hour12: false,
})

/**
 * Format a timestamp as "HH:MM:SS.sss"
 */
export function formatTimestampMs(timestamp: number) {
	return formatMmSsMs.format(new Date(timestamp))
}

const KB = 1024
const MB = 1024 * KB
const GB = 1024 * MB

export function bytesSizeToHuman(size?: number) {
	if (size == null) return "none"
	if (size < KB) return `${size}B`
	if (size < MB) return `${(size / KB).toFixed(2)}KB`
	if (size < GB) return `${(size / MB).toFixed(2)}MB`
	return `${(size / GB).toFixed(2)}GB`
}

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
		port1.postMessage(rs, [rs as unknown as Transferable])
		return true
	} catch {
		return false
	} finally {
		port1.close()
	}
}
