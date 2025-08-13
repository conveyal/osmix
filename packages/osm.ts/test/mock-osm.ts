import { Osm } from "../src/osm"

const YAKIM_LAT = 46.60207
const YAKIM_LON = -120.505898

const ONE_KM_LON = 0.0131 // approximately
const ONE_KM_LAT = 0.009

function addBaseNodes(osm: Osm) {
	osm.nodes.addNode({
		id: 0,
		lat: YAKIM_LAT,
		lon: YAKIM_LON,
	})
	osm.nodes.addNode({
		id: 1,
		lat: YAKIM_LAT,
		lon: YAKIM_LON + ONE_KM_LON, // approximately 1km east
	})
}

function addBaseWays(osm: Osm) {
	osm.ways.addWay({
		id: 1,
		refs: [0, 1],
		tags: {
			highway: "primary",
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
	osm.nodes.addNode({
		...node1,
		id: 2,
	})
	osm.nodes.addNode({
		...node2,
		id: 3,
		lon: YAKIM_LON + ONE_KM_LON * 2, // ends 2km east of the center point
	})

	// Add nodes for disconnected way
	osm.nodes.addNode({
		id: 4,
		lat: YAKIM_LAT - ONE_KM_LAT, // 1km south
		lon: YAKIM_LON + ONE_KM_LON / 4, // 250m east
	})
	osm.nodes.addNode({
		id: 5,
		lat: YAKIM_LAT + ONE_KM_LAT, // 1km north
		lon: YAKIM_LON + ONE_KM_LON / 4, // 250m east
	})

	// Add nodes for crossing way
	osm.nodes.addNode({
		id: 6,
		lat: YAKIM_LAT - ONE_KM_LAT, // 1km south
		lon: YAKIM_LON + ONE_KM_LON / 2, // 500m east
	})
	osm.nodes.addNode({
		id: 7,
		lat: YAKIM_LAT + ONE_KM_LAT, // 1km north
		lon: YAKIM_LON + ONE_KM_LON / 2, // 500m east
	})

	osm.nodes.finish()

	// Add base way with new tags
	osm.ways.addWay({
		id: 1,
		refs: [0, 1],
		tags: {
			highway: "primary",
		},
	})

	osm.ways.addWay({
		id: 2,
		refs: [2, 3],
		tags: {
			highway: "secondary",
		},
	})

	// Add way that crosses, and should generate an intersection
	osm.ways.addWay({
		id: 3,
		refs: [4, 5],
		tags: {
			highway: "primary",
		},
	})

	// Add a way that crosses, but has a tag indicating it is an underpass and should be left alone
	osm.ways.addWay({
		id: 4,
		refs: [6, 7],
		tags: {
			highway: "underpass",
			tunnel: "yes",
		},
	})

	osm.finish()
	return osm
}
