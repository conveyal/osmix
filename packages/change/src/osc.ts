/**
 * OSC (OSM Change) XML generation.
 *
 * Converts changeset data into the standard OSC XML format used by
 * OpenStreetMap for change uploads and auditing.
 *
 * Supports augmented diffs (https://wiki.openstreetmap.org/wiki/Overpass_API/Augmented_Diffs)
 * which include both old and new versions of modified/deleted elements.
 *
 * @module
 */

import type { OsmNode, OsmRelation, OsmWay } from "@osmix/shared/types"
import type { OsmChangeset } from "./changeset"
import { osmTagsToOscTags } from "./utils"

/**
 * Generate a node XML element.
 */
function nodeToXml(node: OsmNode): string {
	const tags = node.tags ? osmTagsToOscTags(node.tags) : ""
	return `<node id="${node.id}" lon="${node.lon}" lat="${node.lat}">${tags}</node>`
}

/**
 * Generate a way XML element.
 */
function wayToXml(way: OsmWay): string {
	const tags = way.tags ? osmTagsToOscTags(way.tags) : ""
	const nodes = way.refs.map((ref) => `<nd ref="${ref}" />`).join("")
	return `<way id="${way.id}">${tags}${nodes}</way>`
}

/**
 * Generate a relation XML element.
 */
function relationToXml(relation: OsmRelation): string {
	const tags = relation.tags ? osmTagsToOscTags(relation.tags) : ""
	const members = relation.members
		.map(
			(member) =>
				`<member type="${member.type}" ref="${member.ref}"${member.role ? ` role="${member.role}"` : ""} />`,
		)
		.join("")
	return `<relation id="${relation.id}">${tags}${members}</relation>`
}

/**
 * Options for OSC generation.
 */
export interface OscOptions {
	/**
	 * When true, generates augmented diffs that include both old and new
	 * versions of modified/deleted elements using `<old>` and `<new>` sections.
	 * See: https://wiki.openstreetmap.org/wiki/Overpass_API/Augmented_Diffs
	 *
	 * @default false
	 */
	augmented: boolean
}

const DEFAULT_OSC_OPTIONS: OscOptions = {
	augmented: false,
}

/**
 * Generate OSC (OSM Change) XML format string from a changeset.
 *
 * Produces an `<osmChange>` document with create, modify, and delete sections
 * containing all nodes, ways, and relations from the changeset.
 *
 * By default, generates standard OSC format compatible with OSM API 0.6 uploads.
 * Set `augmented: true` to include both old and new versions of elements wrapped
 * in `<old>` and `<new>` elements, following the Overpass API Augmented Diffs format.
 *
 * @param changeset - The changeset to serialize.
 * @param options - Options for OSC generation.
 * @returns XML string in OSC format.
 *
 * @example
 * ```ts
 * // Generate standard OSC for API uploads (default)
 * const osc = generateOscChanges(changeset)
 *
 * // Generate augmented diff with old/new sections
 * const augmentedOsc = generateOscChanges(changeset, { augmented: true })
 *
 * await Bun.write('changes.osc', osc)
 * ```
 */
export function generateOscChanges(
	changeset: OsmChangeset,
	options: Partial<OscOptions> = {},
) {
	const { augmented } = { ...DEFAULT_OSC_OPTIONS, ...options }

	let create = ""
	let modify = ""
	let del = ""

	for (const node of Object.values(changeset.nodeChanges)) {
		if (node.changeType === "create") {
			create += nodeToXml(node.entity)
		} else if (node.changeType === "modify") {
			if (augmented && node.oldEntity) {
				modify += `<old>${nodeToXml(node.oldEntity)}</old><new>${nodeToXml(node.entity)}</new>`
			} else {
				modify += nodeToXml(node.entity)
			}
		} else if (node.changeType === "delete") {
			if (augmented && node.oldEntity) {
				del += `<old>${nodeToXml(node.oldEntity)}</old>`
			} else {
				del += `<node id="${node.entity.id}" />`
			}
		}
	}

	for (const way of Object.values(changeset.wayChanges)) {
		if (way.changeType === "create") {
			create += wayToXml(way.entity)
		} else if (way.changeType === "modify") {
			if (augmented && way.oldEntity) {
				modify += `<old>${wayToXml(way.oldEntity)}</old><new>${wayToXml(way.entity)}</new>`
			} else {
				modify += wayToXml(way.entity)
			}
		} else if (way.changeType === "delete") {
			if (augmented && way.oldEntity) {
				del += `<old>${wayToXml(way.oldEntity)}</old>`
			} else {
				del += `<way id="${way.entity.id}" />`
			}
		}
	}

	for (const relation of Object.values(changeset.relationChanges)) {
		if (relation.changeType === "create") {
			create += relationToXml(relation.entity)
		} else if (relation.changeType === "modify") {
			if (augmented && relation.oldEntity) {
				modify += `<old>${relationToXml(relation.oldEntity)}</old><new>${relationToXml(relation.entity)}</new>`
			} else {
				modify += relationToXml(relation.entity)
			}
		} else if (relation.changeType === "delete") {
			if (augmented && relation.oldEntity) {
				del += `<old>${relationToXml(relation.oldEntity)}</old>`
			} else {
				del += `<relation id="${relation.entity.id}" />`
			}
		}
	}

	return `
        <osmChange version="0.6" generator="@osmix/core">
            <create>${create}</create>
            <modify>${modify}</modify>
            <delete>${del}</delete>
        </osmChange>
    `
}
