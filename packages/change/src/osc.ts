import type { OsmChangeset } from "./changeset"
import { osmTagsToOscTags } from "./utils"

/**
 * Generate OSC (OSM Change) XML format string from this changeset.
 * Returns an `<osmChange>` document containing create, modify, and delete sections.
 */
export function generateOscChanges(changeset: OsmChangeset) {
	let create = ""
	let modify = ""
	let del = ""

	for (const node of Object.values(changeset.nodeChanges)) {
		const tags = node.entity.tags ? osmTagsToOscTags(node.entity.tags) : ""
		if (node.changeType === "create") {
			create += `<node id="${node.entity.id}" lon="${node.entity.lon}" lat="${node.entity.lat}">${tags}</node>`
		} else if (node.changeType === "modify") {
			modify += `<node id="${node.entity.id}" lon="${node.entity.lon}" lat="${node.entity.lat}">${tags}</node>`
		} else if (node.changeType === "delete") {
			del += `<node id="${node.entity.id}" />`
		}
	}

	for (const way of Object.values(changeset.wayChanges)) {
		const tags = way.entity.tags ? osmTagsToOscTags(way.entity.tags) : ""
		const nodes = way.entity.refs.map((ref) => `<nd id="${ref}" />`).join("")
		if (way.changeType === "create") {
			create += `<way id="${way.entity.id}">${tags}${nodes}</way>`
		} else if (way.changeType === "modify") {
			modify += `<way id="${way.entity.id}">${tags}${nodes}</way>`
		} else if (way.changeType === "delete") {
			del += `<way id="${way.entity.id}" />`
		}
	}

	for (const relation of Object.values(changeset.relationChanges)) {
		const tags = relation.entity.tags
			? osmTagsToOscTags(relation.entity.tags)
			: ""
		const members = relation.entity.members
			.map(
				(member) =>
					`<member type="${member.type}" ref="${member.ref}"${member.role ? ` role="${member.role}"` : ""} />`,
			)
			.join("")
		if (relation.changeType === "create") {
			create += `<relation id="${relation.entity.id}">${tags}${members}</relation>`
		} else if (relation.changeType === "modify") {
			modify += `<relation id="${relation.entity.id}">${tags}${members}</relation>`
		} else if (relation.changeType === "delete") {
			del += `<relation id="${relation.entity.id}" />`
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
