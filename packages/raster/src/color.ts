import type { Rgba } from "@osmix/shared/types"

/**
 * Convert an sRGB channel (0..255) to linear light (0..1).
 * Uses the IEC 61966-2-1 transfer function (a piecewise EOTF with 2.4 gamma).
 * Blend in linear space for physically meaningful results.
 */
function srgbToLinear(u: number) {
	const c = u / 255
	return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4
}

/**
 * Convert a linear-light channel (0..1) back to sRGB (0..255).
 * Inverse of `srgbToLinear`. Keep these two in sync.
 */
function linearToSrgb(x: number) {
	return x <= 0.0031308
		? 255 * (12.92 * x)
		: 255 * (1.055 * x ** (1 / 2.4) - 0.055)
}

/**
 * Porter–Duff “source-over” in premultiplied *linear* space.
 * Both `dst` and `src` are [r,g,b,a] where r,g,b are already premultiplied by a,
 * and a is in [0..1]. Returns a premultiplied result.
 *
 * Formulas:
 *   a_out = a_src + a_dst * (1 - a_src)
 *   c_out = c_src + c_dst * (1 - a_src)  // for each of r,g,b (premultiplied)
 */
function over(dst: Rgba, src: Rgba): Rgba {
	const a = src[3] + dst[3] * (1 - src[3])
	const r = src[0] + dst[0] * (1 - src[3])
	const g = src[1] + dst[1] * (1 - src[3])
	const b = src[2] + dst[2] * (1 - src[3])
	return [r, g, b, a]
}

/**
 * Composite an ordered list of RGBA pixels using premultiplied alpha.
 *
 * Pipeline per pixel:
 *  1) Convert sRGB (0..255) to linear light (0..1).
 *  2) Premultiply color by alpha.
 *  3) Fold left with Porter–Duff “over” starting from transparent.
 *  4) Unpremultiply and convert back to RGBA (0..255).
 *
 * Returns an RGBA tuple.
 * Notes:
 *  - Drawing the same semi‑transparent color repeatedly increases coverage:
 *      α_n = 1 - (1 - α)^n
 *  - Order matters when colors differ (standard source‑over compositing).
 */
export function compositeRGBA(pixels: Rgba[]): Rgba {
	// start transparent in linear, premultiplied space
	let acc: Rgba = [0, 0, 0, 0]

	for (const [r8, g8, b8, a8] of pixels) {
		if (
			r8 === undefined ||
			g8 === undefined ||
			b8 === undefined ||
			a8 === undefined
		)
			continue
		const a = a8 / 255
		const r = srgbToLinear(r8) * a
		const g = srgbToLinear(g8) * a
		const b = srgbToLinear(b8) * a
		acc = over(acc, [r, g, b, a])
	}

	if (acc[3] <= 0) return [0, 0, 0, 0]

	// unpremultiply + convert back to sRGB
	const r8 = Math.round(
		Math.min(255, Math.max(0, linearToSrgb(acc[0] / acc[3]))),
	)
	const g8 = Math.round(
		Math.min(255, Math.max(0, linearToSrgb(acc[1] / acc[3]))),
	)
	const b8 = Math.round(
		Math.min(255, Math.max(0, linearToSrgb(acc[2] / acc[3]))),
	)
	const a8 = Math.round(Math.min(255, Math.max(0, acc[3] * 255)))
	return [r8, g8, b8, a8]
}
