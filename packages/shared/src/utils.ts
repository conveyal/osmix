/**
 * General OSM entity utilities.
 *
 * Provides type guards, equality checks, and type detection for OSM entities.
 * Uses deep equality checking for tags, info, and entity-specific properties.
 *
 * @module
 */

import { dequal } from "dequal/lite"
import type {
	OsmEntity,
	OsmEntityType,
	OsmNode,
	OsmRelation,
	OsmWay,
} from "./types"

/**
 * Check if two entities have equal tags and info.
 */
function isTagsAndInfoEqual(a: OsmEntity, b: OsmEntity) {
	return dequal(a.tags, b.tags) && dequal(a.info, b.info)
}

/** Type guard: check if entity is a Node. */
export function isNode(entity: OsmEntity): entity is OsmNode {
	return "lon" in entity && "lat" in entity
}

/** Check if two nodes are equal (position, tags, and info). */
export function isNodeEqual(a: OsmNode, b: OsmNode) {
	return a.lat === b.lat && a.lon === b.lon && isTagsAndInfoEqual(a, b)
}

/** Type guard: check if entity is a Way. */
export function isWay(entity: OsmEntity): entity is OsmWay {
	return "refs" in entity
}

/** Type guard: check if entity is a Relation. */
export function isRelation(entity: OsmEntity): entity is OsmRelation {
	return "members" in entity
}

/** Check if two ways are equal (refs, tags, and info). */
export function isWayEqual(a: OsmWay, b: OsmWay) {
	return dequal(a.refs, b.refs) && isTagsAndInfoEqual(a, b)
}

/** Check if two relations are equal (members, tags, and info). */
export function isRelationEqual(a: OsmRelation, b: OsmRelation) {
	return dequal(a.members, b.members) && isTagsAndInfoEqual(a, b)
}

/** Check if two entities have equal properties (type-aware comparison). */
export function entityPropertiesEqual(a: OsmEntity, b: OsmEntity) {
	if (!dequal(a.tags, b.tags)) return false
	if (!dequal(a.info, b.info)) return false
	if (isNode(a) && isNode(b)) return isNodeEqual(a, b)
	if (isWay(a) && isWay(b)) return isWayEqual(a, b)
	if (isRelation(a) && isRelation(b)) return isRelationEqual(a, b)
	return false
}

/** Get the entity type ("node", "way", or "relation") for an entity. */
export function getEntityType(entity: OsmEntity): OsmEntityType {
	if (isNode(entity)) return "node"
	if (isWay(entity)) return "way"
	if (isRelation(entity)) return "relation"
	throw Error("Unknown entity type")
}

/**
 * Check if a relation is a multipolygon relation.
 */
export function isMultipolygonRelation(relation: OsmRelation): boolean {
	return relation.tags?.["type"] === "multipolygon"
}
