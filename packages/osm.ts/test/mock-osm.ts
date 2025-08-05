import { Osm } from "../src/osm"

const YAKIM_LAT = 46.60207
const YAKIM_LON = -120.505898

const ONE_KM_LON = 0.0131 // approximately
const ONE_KM_LAT = 0.009

function addBaseNodes(osm: Osm) {
	osm.addEntity({
		id: 0,
		lat: YAKIM_LAT,
		lon: YAKIM_LON,
	})
	osm.addEntity({
		id: 1,
		lat: YAKIM_LAT,
		lon: YAKIM_LON + ONE_KM_LON, // approximately 1km east
	})
}

function addBaseWays(osm: Osm) {
	osm.addEntity({
		id: 1,
		refs: [0, 1],
		tags: {
			key: "value",
		},
	})
}

/**
 * Create a base OSM with one way and two nodes.
 */
export function createBaseOsm(): Osm {
	const base = new Osm()
	addBaseNodes(base)
	base.nodes.finish()
	addBaseWays(base)
	base.ways.finish()
	base.finish()
	return base
}

/**
 * Create a patch OSM with:
 * - The same way as the base OSM, with new tags
 * - A way that has an overlapping node with the first way, but does not share a node and so starts disconnected
 * - A way that crosses over the first way, but does not share a node and so starts disconnected
 */
export function createPatchOsm(): Osm {
	const osm = new Osm()

	// Add all nodes
	addBaseNodes(osm)

	const node1 = osm.nodes.getByIndex(0)
	const node2 = osm.nodes.getByIndex(1)
	if (!node1 || !node2) throw new Error("node not found")

	// Add disconnected way
	osm.addEntity({
		...node1,
		id: 2,
	})
	osm.addEntity({
		...node2,
		id: 3,
		lon: YAKIM_LON + ONE_KM_LON * 2, // ends 2km east of the center point
	})

	// Add nodes for disconnected way
	osm.addEntity({
		id: 4,
		lat: YAKIM_LAT - ONE_KM_LAT, // 1km south
		lon: YAKIM_LON + ONE_KM_LON / 4, // 250m east
	})
	osm.addEntity({
		id: 5,
		lat: YAKIM_LAT + ONE_KM_LAT, // 1km north
		lon: YAKIM_LON + ONE_KM_LON / 4, // 250m east
	})

	// Add nodes for crossing way
	osm.addEntity({
		id: 6,
		lat: YAKIM_LAT - ONE_KM_LAT, // 1km south
		lon: YAKIM_LON + ONE_KM_LON / 2, // 500m east
	})
	osm.addEntity({
		id: 7,
		lat: YAKIM_LAT + ONE_KM_LAT, // 1km north
		lon: YAKIM_LON + ONE_KM_LON / 2, // 500m east
	})

	osm.nodes.finish()

	// Add base way with new tags
	osm.addEntity({
		id: 1,
		refs: [0, 1],
		tags: {
			key: "newValue",
		},
	})

	osm.addEntity({
		id: 2,
		refs: [2, 3],
		tags: {
			key: "disconnected",
		},
	})

	// Add way that crosses, and should generate an intersection
	osm.addEntity({
		id: 3,
		refs: [4, 5],
		tags: {
			key: "intersecting",
		},
	})

	// Add a way that crosses, but has a tag indicating it is an underpass and should be left alone
	osm.addEntity({
		id: 4,
		refs: [6, 7],
		tags: {
			highway: "intersecting",
		},
	})

	osm.ways.finish()
	osm.finish()
	return osm
}
