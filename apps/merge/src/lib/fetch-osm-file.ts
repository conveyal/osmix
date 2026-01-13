function isSupportedOsmFileName(name: string): boolean {
	const lower = name.toLowerCase()
	return (
		lower.endsWith(".pbf") ||
		lower.endsWith(".geojson") ||
		lower.endsWith(".json") ||
		lower.endsWith(".zip") ||
		lower.endsWith(".parquet")
	)
}

function stripQuotes(s: string): string {
	if (
		(s.startsWith('"') && s.endsWith('"')) ||
		(s.startsWith("'") && s.endsWith("'"))
	) {
		return s.slice(1, -1)
	}
	return s
}

function fileNameFromContentDisposition(header: string | null): string | null {
	if (!header) return null

	// Very small parser for common cases:
	// - attachment; filename="foo.pbf"
	// - attachment; filename*=UTF-8''foo.pbf
	const parts = header.split(";").map((p) => p.trim())
	for (const part of parts) {
		if (part.toLowerCase().startsWith("filename*=")) {
			const value = stripQuotes(part.slice("filename*=".length).trim())
			const idx = value.indexOf("''")
			const encoded = idx >= 0 ? value.slice(idx + 2) : value
			try {
				return decodeURIComponent(encoded)
			} catch {
				return encoded
			}
		}
		if (part.toLowerCase().startsWith("filename=")) {
			return stripQuotes(part.slice("filename=".length).trim())
		}
	}
	return null
}

function fileNameFromUrl(url: URL): string | null {
	const last = url.pathname.split("/").filter(Boolean).at(-1)
	if (!last) return null
	try {
		return decodeURIComponent(last)
	} catch {
		return last
	}
}

function extensionFromContentType(contentType: string | null): string | null {
	if (!contentType) return null
	const type = contentType.split(";")[0]?.trim().toLowerCase()
	if (!type) return null

	if (type === "application/x-protobuf") return ".pbf"
	if (type === "application/vnd.mapbox-vector-tile") return ".pbf"
	if (type === "application/geo+json") return ".geojson"
	if (type === "application/json") return ".json"
	if (type === "text/json") return ".json"
	if (type === "application/zip") return ".zip"
	if (type === "application/x-zip-compressed") return ".zip"
	if (type === "application/vnd.apache.parquet") return ".parquet"
	return null
}

function ensureExtension(name: string, ext: string): string {
	return name.toLowerCase().endsWith(ext) ? name : `${name}${ext}`
}

export async function fetchOsmFileFromUrl(
	inputUrl: string,
	options?: { baseUrl?: string },
): Promise<File> {
	const trimmed = inputUrl.trim()
	if (trimmed.length === 0) {
		throw new Error("URL is empty")
	}

	const baseUrl =
		options?.baseUrl ??
		(globalThis.location ? globalThis.location.href : undefined)
	const url = new URL(trimmed, baseUrl)

	const res = await fetch(url.toString())
	if (!res.ok) {
		throw new Error(`Failed to fetch (${res.status}) ${res.statusText}`)
	}

	const contentDisposition = res.headers.get("content-disposition")
	const contentType = res.headers.get("content-type")

	let name =
		fileNameFromContentDisposition(contentDisposition) ??
		fileNameFromUrl(url) ??
		"download"

	if (!isSupportedOsmFileName(name)) {
		const ext = extensionFromContentType(contentType)
		if (ext) name = ensureExtension(name, ext)
	}

	if (!isSupportedOsmFileName(name)) {
		throw new Error(
			`URL must resolve to a .pbf, .geojson, .json, .zip, or .parquet file (got "${name}")`,
		)
	}

	const buffer = await res.arrayBuffer()
	return new File([buffer], name, { type: contentType ?? undefined })
}
