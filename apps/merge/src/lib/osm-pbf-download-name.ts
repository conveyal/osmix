export function ensureOsmPbfDownloadName(filename: string): string {
	if (filename.toLowerCase().endsWith(".pbf")) return filename

	const lastDot = filename.lastIndexOf(".")
	if (lastDot <= 0) return `${filename}.pbf`

	return `${filename.slice(0, lastDot)}.pbf`
}
