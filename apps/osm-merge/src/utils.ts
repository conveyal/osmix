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
		.filter(([key, value]) => {
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
	if (id === "osm-tk:patch-geojson") return "Patch"
	if (id === "osm-tk:base-geojson") return "Base"
	if (id === "osm-tk:patch-way-geojson") return "Current Way"
	return id
}

const formatMmSsMs = new Intl.DateTimeFormat("en-US", {
	minute: "2-digit",
	second: "2-digit",
	fractionalSecondDigits: 3,
	hour12: false,
})

/**
 * Format a timestamp as "MM:SS.sss"
 */
export function formatTimestampMs(timestamp: number) {
	return formatMmSsMs.format(new Date(timestamp))
}
