import type { Osm } from "@osmix/core"
import type { OsmEntity } from "@osmix/shared/types"

export function getOsmixEntityByStringId(
	osm: Osm,
	eid: string,
): OsmEntity | null {
	const [type, sid] = eid.split("/")
	const id = Number(sid)
	switch (type) {
		case "node":
			return osm.nodes.get({ id })
		case "way":
			return osm.ways.get({ id })
		case "relation":
			return osm.relations.get({ id })
		default:
			return null
	}
}

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

/**
 * Check if the browser supports transferable streams by trying to create an empty stream and sending it to a message channel.
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
		port1.postMessage(rs, [rs as unknown as Transferable])
		return true
	} catch {
		return false
	} finally {
		port1.close()
	}
}
