import { assert, test } from "vitest"
import { haversineDistance } from "../src/utils"

test("haversineDistance", () => {
	const p1: [number, number] = [-75.343, 39.984]
	const p2: [number, number] = [-75.534, 39.123]
	assert.closeTo(haversineDistance(p1, p2), 97129.2211, 0.0001)
})
