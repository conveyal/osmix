import type { Rgba } from "@osmix/shared/types"
import { describe, expect, test } from "vitest"
import { compositeRGBA } from "../src/color"

const W50: Rgba = [255, 255, 255, 128]
const R50: Rgba = [255, 0, 0, 128]
const B50: Rgba = [0, 0, 0, 128]

describe("compositeRGBA (premultiplied alpha in linear space)", () => {
	test("two passes of 50% white yields 75% alpha", () => {
		expect(compositeRGBA([W50, W50])).toEqual([255, 255, 255, 192])
	})

	test("order matters for different colors (white then red vs red then white)", () => {
		expect(compositeRGBA([W50, R50])).toEqual([255, 156, 156, 192])
		expect(compositeRGBA([R50, W50])).toEqual([255, 213, 213, 192])
	})

	test("mixing with black follows the same rule", () => {
		expect(compositeRGBA([W50, B50])).toEqual([156, 156, 156, 192])
		expect(compositeRGBA([B50, W50])).toEqual([213, 213, 213, 192])
	})

	test("empty input returns fully transparent", () => {
		expect(compositeRGBA([])).toEqual([0, 0, 0, 0])
	})
})
