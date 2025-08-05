import { EntityIndex } from "./entity-index"
import type { OsmRelation, OsmRelationMember, OsmTags } from "./types"

export class RelationIndex extends EntityIndex<OsmRelation> {
	members = new Map<number, OsmRelationMember[]>()

	add(relation: OsmRelation) {
		super.add(relation)
		this.members.set(relation.id, relation.members)
	}

	finishEntityIndex() {}

	getFullEntity(index: number, id: number, tags?: OsmTags): OsmRelation {
		return {
			id,
			members: this.members.get(id) ?? [],
			tags,
		}
	}

	set(_: OsmRelation) {
		throw Error("RelationIndex.set not implemented yet")
	}
}
