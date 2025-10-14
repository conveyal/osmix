import type { OsmEntity, OsmEntityType } from "@osmix/json"

// String that starts with `n`, `w`, or `r` followed by the ID
export type OsmEntityRef = {
	type: OsmEntityType
	id: number
	osmId: string
}

export type OsmChange<T extends OsmEntity = OsmEntity> = {
	changeType: "modify" | "create" | "delete"
	entity: T
	osmId: string // When merging datasets, we need to keep track of the entity's origin dataset.

	// Used to lookup related entities, refs, and relations
	refs?: OsmEntityRef[]
}
