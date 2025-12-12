import { describe, expect, it } from "bun:test"
import { parseWkb } from "../src/wkb"

/**
 * Helper to create a WKB Point with properly encoded float64 coordinates.
 */
function createPointWkb(
	lon: number,
	lat: number,
	littleEndian = true,
): Uint8Array {
	const buffer = new ArrayBuffer(21)
	const view = new DataView(buffer)
	let offset = 0

	view.setUint8(offset, littleEndian ? 1 : 0)
	offset += 1
	view.setUint32(offset, 1, littleEndian) // Point type
	offset += 4
	view.setFloat64(offset, lon, littleEndian)
	offset += 8
	view.setFloat64(offset, lat, littleEndian)

	return new Uint8Array(buffer)
}

describe("@osmix/layercake: WKB Parser", () => {
	it("should parse a Point geometry (little endian)", () => {
		const wkb = createPointWkb(-122.4194, 37.7749, true)

		const geometry = parseWkb(wkb)

		expect(geometry.type).toBe("Point")
		if (geometry.type === "Point") {
			expect(geometry.coordinates[0]).toBeCloseTo(-122.4194, 4)
			expect(geometry.coordinates[1]).toBeCloseTo(37.7749, 4)
		}
	})

	it("should parse a Point geometry (big endian)", () => {
		const wkb = createPointWkb(-122.4194, 37.7749, false)

		const geometry = parseWkb(wkb)

		expect(geometry.type).toBe("Point")
		if (geometry.type === "Point") {
			expect(geometry.coordinates[0]).toBeCloseTo(-122.4194, 4)
			expect(geometry.coordinates[1]).toBeCloseTo(37.7749, 4)
		}
	})

	it("should parse a LineString geometry", () => {
		// WKB LineString with 3 points
		const buffer = new ArrayBuffer(1 + 4 + 4 + 3 * 16)
		const view = new DataView(buffer)
		let offset = 0

		// Byte order: little endian
		view.setUint8(offset, 1)
		offset += 1

		// Geometry type: LineString (2)
		view.setUint32(offset, 2, true)
		offset += 4

		// Number of points: 3
		view.setUint32(offset, 3, true)
		offset += 4

		// Point 1: -122.4194, 37.7749
		view.setFloat64(offset, -122.4194, true)
		offset += 8
		view.setFloat64(offset, 37.7749, true)
		offset += 8

		// Point 2: -122.4094, 37.7849
		view.setFloat64(offset, -122.4094, true)
		offset += 8
		view.setFloat64(offset, 37.7849, true)
		offset += 8

		// Point 3: -122.3994, 37.7949
		view.setFloat64(offset, -122.3994, true)
		offset += 8
		view.setFloat64(offset, 37.7949, true)

		const wkb = new Uint8Array(buffer)
		const geometry = parseWkb(wkb)

		expect(geometry.type).toBe("LineString")
		if (geometry.type === "LineString") {
			expect(geometry.coordinates).toHaveLength(3)
			expect(geometry.coordinates[0]?.[0]).toBeCloseTo(-122.4194, 4)
			expect(geometry.coordinates[0]?.[1]).toBeCloseTo(37.7749, 4)
			expect(geometry.coordinates[1]?.[0]).toBeCloseTo(-122.4094, 4)
			expect(geometry.coordinates[1]?.[1]).toBeCloseTo(37.7849, 4)
			expect(geometry.coordinates[2]?.[0]).toBeCloseTo(-122.3994, 4)
			expect(geometry.coordinates[2]?.[1]).toBeCloseTo(37.7949, 4)
		}
	})

	it("should parse a Polygon geometry", () => {
		// WKB Polygon with 1 ring of 5 points (closed)
		const buffer = new ArrayBuffer(1 + 4 + 4 + 4 + 5 * 16)
		const view = new DataView(buffer)
		let offset = 0

		// Byte order: little endian
		view.setUint8(offset, 1)
		offset += 1

		// Geometry type: Polygon (3)
		view.setUint32(offset, 3, true)
		offset += 4

		// Number of rings: 1
		view.setUint32(offset, 1, true)
		offset += 4

		// Number of points in ring: 5
		view.setUint32(offset, 5, true)
		offset += 4

		// Points (closed ring)
		const coords = [
			[-122.4194, 37.7749],
			[-122.4094, 37.7749],
			[-122.4094, 37.7849],
			[-122.4194, 37.7849],
			[-122.4194, 37.7749], // closed
		]

		for (const [lon, lat] of coords) {
			view.setFloat64(offset, lon!, true)
			offset += 8
			view.setFloat64(offset, lat!, true)
			offset += 8
		}

		const wkb = new Uint8Array(buffer)
		const geometry = parseWkb(wkb)

		expect(geometry.type).toBe("Polygon")
		if (geometry.type === "Polygon") {
			expect(geometry.coordinates).toHaveLength(1)
			expect(geometry.coordinates[0]).toHaveLength(5)
			expect(geometry.coordinates[0]?.[0]?.[0]).toBeCloseTo(-122.4194, 4)
			expect(geometry.coordinates[0]?.[0]?.[1]).toBeCloseTo(37.7749, 4)
		}
	})

	it("should parse a MultiPolygon geometry", () => {
		// Helper to create polygon WKB
		const createPolygonWkb = (
			coords: [number, number][][],
		): [ArrayBuffer, number] => {
			const totalPoints = coords.reduce((sum, ring) => sum + ring.length, 0)
			const size = 1 + 4 + 4 + coords.length * 4 + totalPoints * 16
			const buffer = new ArrayBuffer(size)
			const view = new DataView(buffer)
			let offset = 0

			// Byte order
			view.setUint8(offset, 1)
			offset += 1

			// Polygon type
			view.setUint32(offset, 3, true)
			offset += 4

			// Number of rings
			view.setUint32(offset, coords.length, true)
			offset += 4

			for (const ring of coords) {
				view.setUint32(offset, ring.length, true)
				offset += 4
				for (const [lon, lat] of ring) {
					view.setFloat64(offset, lon, true)
					offset += 8
					view.setFloat64(offset, lat, true)
					offset += 8
				}
			}

			return [buffer, size]
		}

		// Create MultiPolygon with 2 polygons
		const poly1Coords: [number, number][][] = [
			[
				[-122.4194, 37.7749],
				[-122.4094, 37.7749],
				[-122.4094, 37.7849],
				[-122.4194, 37.7849],
				[-122.4194, 37.7749],
			],
		]

		const poly2Coords: [number, number][][] = [
			[
				[-122.3994, 37.7649],
				[-122.3894, 37.7649],
				[-122.3894, 37.7749],
				[-122.3994, 37.7749],
				[-122.3994, 37.7649],
			],
		]

		const [poly1Buffer, poly1Size] = createPolygonWkb(poly1Coords)
		const [poly2Buffer, poly2Size] = createPolygonWkb(poly2Coords)

		// MultiPolygon header + 2 polygons
		const multiBuffer = new ArrayBuffer(1 + 4 + 4 + poly1Size + poly2Size)
		const multiView = new DataView(multiBuffer)
		let offset = 0

		// Byte order
		multiView.setUint8(offset, 1)
		offset += 1

		// MultiPolygon type (6)
		multiView.setUint32(offset, 6, true)
		offset += 4

		// Number of geometries
		multiView.setUint32(offset, 2, true)
		offset += 4

		// Copy polygon 1
		new Uint8Array(multiBuffer, offset, poly1Size).set(
			new Uint8Array(poly1Buffer),
		)
		offset += poly1Size

		// Copy polygon 2
		new Uint8Array(multiBuffer, offset, poly2Size).set(
			new Uint8Array(poly2Buffer),
		)

		const wkb = new Uint8Array(multiBuffer)
		const geometry = parseWkb(wkb)

		expect(geometry.type).toBe("MultiPolygon")
		if (geometry.type === "MultiPolygon") {
			expect(geometry.coordinates).toHaveLength(2)
			expect(geometry.coordinates[0]).toHaveLength(1)
			expect(geometry.coordinates[1]).toHaveLength(1)
		}
	})

	it("should handle EWKB with SRID flag", () => {
		// EWKB Point with SRID (SRID flag: 0x20000000)
		const buffer = new ArrayBuffer(1 + 4 + 4 + 16)
		const view = new DataView(buffer)
		let offset = 0

		// Byte order: little endian
		view.setUint8(offset, 1)
		offset += 1

		// Geometry type: Point (1) with SRID flag (0x20000001)
		view.setUint32(offset, 0x20000001, true)
		offset += 4

		// SRID: 4326
		view.setUint32(offset, 4326, true)
		offset += 4

		// Point: -122.4194, 37.7749
		view.setFloat64(offset, -122.4194, true)
		offset += 8
		view.setFloat64(offset, 37.7749, true)

		const wkb = new Uint8Array(buffer)
		const geometry = parseWkb(wkb)

		expect(geometry.type).toBe("Point")
		if (geometry.type === "Point") {
			expect(geometry.coordinates[0]).toBeCloseTo(-122.4194, 4)
			expect(geometry.coordinates[1]).toBeCloseTo(37.7749, 4)
		}
	})

	it("should throw on unsupported geometry type", () => {
		const wkb = new Uint8Array([
			0x01, // little endian
			0x64,
			0x00,
			0x00,
			0x00, // Invalid type (100)
		])

		expect(() => parseWkb(wkb)).toThrow("GeometryType 100 not supported")
	})
})
