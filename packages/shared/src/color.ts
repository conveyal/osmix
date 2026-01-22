import type { Rgba } from "./types"

const hexPattern = /^[0-9a-fA-F]+$/

export function normalizeHexColor(
	value: string | number | null | undefined,
): string | undefined {
	if (value === null || value === undefined) return
	const raw = String(value).trim()
	if (!raw) return
	let hex = raw.startsWith("#") ? raw.slice(1) : raw
	if (!hexPattern.test(hex)) return

	if (hex.length === 3 || hex.length === 4) {
		hex = hex
			.split("")
			.map((char) => `${char}${char}`)
			.join("")
	} else if (hex.length !== 6 && hex.length !== 8) {
		return
	}

	return `#${hex.toUpperCase()}`
}

export function hexColorToRgba(
	value: string | number | null | undefined,
): Rgba | undefined {
	const normalized = normalizeHexColor(value)
	if (!normalized) return
	const hex = normalized.slice(1)
	const r = Number.parseInt(hex.slice(0, 2), 16)
	const g = Number.parseInt(hex.slice(2, 4), 16)
	const b = Number.parseInt(hex.slice(4, 6), 16)
	const a = hex.length === 8 ? Number.parseInt(hex.slice(6, 8), 16) : 255
	return [r, g, b, a]
}
