import type { OsmNode } from "@osmix/shared/types"
import { Osm } from "./osm"

const YAKIM_LAT = 46.60207
const YAKIM_LON = -120.505898

const ONE_KM_LON = 0.0131 // approximately
const ONE_KM_LAT = 0.009

const node0: OsmNode = {
	id: 0,
	lat: YAKIM_LAT,
	lon: YAKIM_LON,
}

const node1: OsmNode = {
	id: 1,
	lat: YAKIM_LAT,
	lon: YAKIM_LON - ONE_KM_LON, // approximately 1km west
}

function addBaseNodes(osm: Osm) {
	osm.nodes.addNode(node0)
	osm.nodes.addNode(node1)
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
export function createMockBaseOsm(): Osm {
	const base = new Osm()
	addBaseNodes(base)
	base.nodes.buildIndex()
	addBaseWays(base)
	base.buildIndexes()
	return base
}

/**
 * Create a patch OSM with:
 * - The same way as the base OSM, with new tags
 * - A way that has an overlapping node with the first way, but does not share a node and so starts disconnected
 * - A way that crosses over the first way, but does not share a node and so starts disconnected
 */
export function createMockPatchOsm(): Osm {
	const osm = new Osm()

	addBaseNodes(osm)

	// Add way the connects with base way node 0 (will replace it)
	osm.nodes.addNode({
		...node0,
		id: 2,
		tags: {
			crossing: "yes",
		},
	})
	osm.nodes.addNode({
		...node1,
		id: 3,
		lon: YAKIM_LON + ONE_KM_LON, // ends 1km east of the center point
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

	osm.nodes.buildIndex()

	// Add same base way with new tags
	osm.ways.addWay({
		id: 1,
		refs: [0, 1],
		tags: {
			highway: "primary",
			version: "2",
		},
	})

	// Add way that overlaps with base way node 1. Node should be de-duplicated.
	osm.ways.addWay({
		id: 2,
		refs: [2, 3],
		tags: {
			highway: "secondary",
		},
	})

	// Add way that crosses way 2, and should generate 1 intersection.
	osm.ways.addWay({
		id: 3,
		refs: [4, 5],
		tags: {
			highway: "primary",
		},
	})

	// Add a way that crosses way 2, but has a tag indicating it is an underpass and should be left alone
	osm.ways.addWay({
		id: 4,
		refs: [6, 7],
		tags: {
			highway: "underpass",
			tunnel: "yes",
		},
	})

	osm.buildIndexes()
	return osm
}
