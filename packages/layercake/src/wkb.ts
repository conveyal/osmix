/**
 * WKB (Well-Known Binary) geometry parser.
 *
 * Parses WKB-encoded geometries from GeoParquet files.
 * Supports Point, LineString, Polygon, MultiPolygon, and their collections.
 *
 * @module
 */

import type {
	Geometry,
	LineString,
	MultiPolygon,
	Point,
	Polygon,
} from "geojson"

// WKB geometry type constants
const WKB_POINT = 1
const WKB_LINESTRING = 2
const WKB_POLYGON = 3
const WKB_MULTIPOINT = 4
const WKB_MULTILINESTRING = 5
const WKB_MULTIPOLYGON = 6
const WKB_GEOMETRYCOLLECTION = 7

/**
 * Parse a WKB geometry into a GeoJSON Geometry object.
 *
 * @param wkb - WKB-encoded geometry as Uint8Array
 * @returns Parsed GeoJSON Geometry
 */
export function parseWkb(wkb: Uint8Array): Geometry {
	const view = new DataView(wkb.buffer, wkb.byteOffset, wkb.byteLength)
	const result = readGeometry(view, 0)
	return result.geometry
}

interface ReadResult<T> {
	geometry: T
	offset: number
}

function readGeometry(
	view: DataView,
	startOffset: number,
): ReadResult<Geometry> {
	let currentOffset = startOffset

	// Byte order: 0 = big endian, 1 = little endian
	const byteOrder = view.getUint8(currentOffset)
	const littleEndian = byteOrder === 1
	currentOffset += 1

	// Geometry type (4 bytes)
	let geometryType = view.getUint32(currentOffset, littleEndian)
	currentOffset += 4

	// Handle EWKB SRID flag (0x20000000) and Z/M flags
	const hasZ =
		(geometryType & 0x80000000) !== 0 || (geometryType & 0x1000) !== 0
	const hasM =
		(geometryType & 0x40000000) !== 0 || (geometryType & 0x2000) !== 0
	const hasSrid = (geometryType & 0x20000000) !== 0

	// Strip flags to get base type
	geometryType = geometryType & 0xff

	// Skip SRID if present
	if (hasSrid) {
		currentOffset += 4
	}

	const coordSize = 2 + (hasZ ? 1 : 0) + (hasM ? 1 : 0)

	switch (geometryType) {
		case WKB_POINT:
			return readPoint(view, currentOffset, littleEndian, coordSize)
		case WKB_LINESTRING:
			return readLineString(view, currentOffset, littleEndian, coordSize)
		case WKB_POLYGON:
			return readPolygon(view, currentOffset, littleEndian, coordSize)
		case WKB_MULTIPOINT:
			return readMultiPoint(view, currentOffset, littleEndian)
		case WKB_MULTILINESTRING:
			return readMultiLineString(view, currentOffset, littleEndian)
		case WKB_MULTIPOLYGON:
			return readMultiPolygon(view, currentOffset, littleEndian)
		case WKB_GEOMETRYCOLLECTION:
			return readGeometryCollection(view, currentOffset, littleEndian)
		default:
			throw new Error(`Unsupported WKB geometry type: ${geometryType}`)
	}
}

function readPoint(
	view: DataView,
	startOffset: number,
	littleEndian: boolean,
	coordSize: number,
): ReadResult<Point> {
	const x = view.getFloat64(startOffset, littleEndian)
	const y = view.getFloat64(startOffset + 8, littleEndian)
	return {
		geometry: {
			type: "Point",
			coordinates: [x, y],
		},
		offset: startOffset + coordSize * 8,
	}
}

function readLineString(
	view: DataView,
	startOffset: number,
	littleEndian: boolean,
	coordSize: number,
): ReadResult<LineString> {
	let currentOffset = startOffset
	const numPoints = view.getUint32(currentOffset, littleEndian)
	currentOffset += 4

	const coordinates: [number, number][] = []
	for (let i = 0; i < numPoints; i++) {
		const x = view.getFloat64(currentOffset, littleEndian)
		const y = view.getFloat64(currentOffset + 8, littleEndian)
		coordinates.push([x, y])
		currentOffset += coordSize * 8
	}

	return {
		geometry: {
			type: "LineString",
			coordinates,
		},
		offset: currentOffset,
	}
}

function readPolygon(
	view: DataView,
	startOffset: number,
	littleEndian: boolean,
	coordSize: number,
): ReadResult<Polygon> {
	let currentOffset = startOffset
	const numRings = view.getUint32(currentOffset, littleEndian)
	currentOffset += 4

	const coordinates: [number, number][][] = []
	for (let r = 0; r < numRings; r++) {
		const numPoints = view.getUint32(currentOffset, littleEndian)
		currentOffset += 4

		const ring: [number, number][] = []
		for (let i = 0; i < numPoints; i++) {
			const x = view.getFloat64(currentOffset, littleEndian)
			const y = view.getFloat64(currentOffset + 8, littleEndian)
			ring.push([x, y])
			currentOffset += coordSize * 8
		}
		coordinates.push(ring)
	}

	return {
		geometry: {
			type: "Polygon",
			coordinates,
		},
		offset: currentOffset,
	}
}

function readMultiPoint(
	view: DataView,
	startOffset: number,
	littleEndian: boolean,
): ReadResult<Geometry> {
	let currentOffset = startOffset
	const numGeoms = view.getUint32(currentOffset, littleEndian)
	currentOffset += 4

	const coordinates: [number, number][] = []
	for (let i = 0; i < numGeoms; i++) {
		const result = readGeometry(view, currentOffset)
		if (result.geometry.type === "Point") {
			coordinates.push(result.geometry.coordinates as [number, number])
		}
		currentOffset = result.offset
	}

	return {
		geometry: {
			type: "MultiPoint",
			coordinates,
		},
		offset: currentOffset,
	}
}

function readMultiLineString(
	view: DataView,
	startOffset: number,
	littleEndian: boolean,
): ReadResult<Geometry> {
	let currentOffset = startOffset
	const numGeoms = view.getUint32(currentOffset, littleEndian)
	currentOffset += 4

	const coordinates: [number, number][][] = []
	for (let i = 0; i < numGeoms; i++) {
		const result = readGeometry(view, currentOffset)
		if (result.geometry.type === "LineString") {
			coordinates.push(result.geometry.coordinates as [number, number][])
		}
		currentOffset = result.offset
	}

	return {
		geometry: {
			type: "MultiLineString",
			coordinates,
		},
		offset: currentOffset,
	}
}

function readMultiPolygon(
	view: DataView,
	startOffset: number,
	littleEndian: boolean,
): ReadResult<MultiPolygon> {
	let currentOffset = startOffset
	const numGeoms = view.getUint32(currentOffset, littleEndian)
	currentOffset += 4

	const coordinates: [number, number][][][] = []
	for (let i = 0; i < numGeoms; i++) {
		const result = readGeometry(view, currentOffset)
		if (result.geometry.type === "Polygon") {
			coordinates.push(result.geometry.coordinates as [number, number][][])
		}
		currentOffset = result.offset
	}

	return {
		geometry: {
			type: "MultiPolygon",
			coordinates,
		},
		offset: currentOffset,
	}
}

function readGeometryCollection(
	view: DataView,
	startOffset: number,
	littleEndian: boolean,
): ReadResult<Geometry> {
	let currentOffset = startOffset
	const numGeoms = view.getUint32(currentOffset, littleEndian)
	currentOffset += 4

	const geometries: Geometry[] = []
	for (let i = 0; i < numGeoms; i++) {
		const result = readGeometry(view, currentOffset)
		geometries.push(result.geometry)
		currentOffset = result.offset
	}

	return {
		geometry: {
			type: "GeometryCollection",
			geometries,
		},
		offset: currentOffset,
	}
}
