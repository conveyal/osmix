import { Osm } from "../src/osm"

const YAKIM_LAT = 46.60207
const YAKIM_LON = -120.505898

const ONE_KM_LON = 0.0131 // approximately
const ONE_KM_LAT = 0.009

/**
 * Create a base OSM with one way and two nodes.
 */
export function createBaseOsm(): Osm {
	const base = new Osm()
	base.addEntity({
		type: "node",
		id: 0,
		lat: YAKIM_LAT,
		lon: YAKIM_LON,
	})
	base.addEntity({
		type: "node",
		id: 1,
		lat: YAKIM_LAT,
		lon: YAKIM_LON + ONE_KM_LON, // approximately 1km east
	})
	base.addEntity({
		type: "way",
		id: 1,
		refs: [0, 1],
		tags: {
			key: "value",
		},
	})
	return base
}

/**
 * Create a patch OSM with:
 * - The same way as the base OSM, with new tags
 * - A way that has an overlapping node with the first way, but does not share a node and so starts disconnected
 * - A way that crosses over the first way, but does not share a node and so starts disconnected
 */
export function createPatchOsm(): Osm {
	const osm = createBaseOsm()
	const way = osm.getEntity("way", 1)
	if (!way) throw new Error("way not found")
	way.tags = {
		key: "newValue",
	}

	// Add disconnected way
	osm.addEntity({
		...osm.getNode(1),
		id: 2,
	})
	osm.addEntity({
		...osm.getNode(1),
		id: 3,
		lon: YAKIM_LON + ONE_KM_LON * 2, // ends 2km east of the center point
	})
	osm.addEntity({
		type: "way",
		id: 2,
		refs: [2, 3],
		tags: {
			key: "disconnected",
		},
	})

	// Add way that crosses, and should generate an intersection
	osm.addEntity({
		type: "node",
		id: 4,
		lat: YAKIM_LAT - ONE_KM_LAT, // 1km south
		lon: YAKIM_LON + ONE_KM_LON / 4, // 250m east
	})
	osm.addEntity({
		type: "node",
		id: 5,
		lat: YAKIM_LAT + ONE_KM_LAT, // 1km north
		lon: YAKIM_LON + ONE_KM_LON / 4, // 250m east
	})
	osm.addEntity({
		type: "way",
		id: 3,
		refs: [4, 5],
		tags: {
			key: "intersecting",
		},
	})

	// Add a way that crosses, but has a tag indicating it is an underpass and should be left alone
	osm.addEntity({
		type: "node",
		id: 6,
		lat: YAKIM_LAT - ONE_KM_LAT, // 1km south
		lon: YAKIM_LON + ONE_KM_LON / 2, // 500m east
	})
	osm.addEntity({
		type: "node",
		id: 7,
		lat: YAKIM_LAT + ONE_KM_LAT, // 1km north
		lon: YAKIM_LON + ONE_KM_LON / 2, // 500m east
	})
	osm.addEntity({
		type: "way",
		id: 4,
		refs: [6, 7],
		tags: {
			highway: "intersecting",
		},
	})

	return osm
}
