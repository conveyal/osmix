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
