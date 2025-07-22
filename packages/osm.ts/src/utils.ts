import { dequal } from "dequal/lite"
import type {
	OsmEntity,
	OsmEntityType,
	OsmNode,
	OsmRelation,
	OsmWay,
} from "./types"

function isTagsAndInfoEqual(a: OsmEntity, b: OsmEntity) {
	return dequal(a.tags, b.tags) && dequal(a.info, b.info)
}

export function isNode(entity: OsmEntity): entity is OsmNode {
	return "lon" in entity && "lat" in entity
}

export function isNodeEqual(a: OsmNode, b: OsmNode) {
	return a.lat === b.lat && a.lon === b.lon && isTagsAndInfoEqual(a, b)
}

export function isWay(entity: OsmEntity): entity is OsmWay {
	return "refs" in entity
}

export function isRelation(entity: OsmEntity): entity is OsmRelation {
	return "members" in entity
}

export function isWayEqual(a: OsmWay, b: OsmWay) {
	return dequal(a.refs, b.refs) && isTagsAndInfoEqual(a, b)
}

export function isRelationEqual(a: OsmRelation, b: OsmRelation) {
	return dequal(a.members, b.members) && isTagsAndInfoEqual(a, b)
}

export function getEntityType(entity: OsmEntity): OsmEntityType {
	if (isNode(entity)) return "node"
	if (isWay(entity)) return "way"
	if (isRelation(entity)) return "relation"
	throw Error("Unknown entity type")
}
