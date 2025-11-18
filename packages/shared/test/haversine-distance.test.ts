import { expect, test } from "bun:test"
import { haversineDistance } from "../src/haversine-distance"

test("haversineDistance", () => {
	const p1: [number, number] = [-75.343, 39.984]
	const p2: [number, number] = [-75.534, 39.123]
	expect(haversineDistance(p1, p2)).toBeCloseTo(97129.2211, 3)
})
