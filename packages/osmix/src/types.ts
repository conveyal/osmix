import type { OsmPbfHeaderBlock } from "@osmix/pbf"
import type { GeoBbox2D } from "@osmix/shared/types"

export interface OsmixInfo {
	id: string
	bbox: GeoBbox2D
	header: OsmPbfHeaderBlock
	nodes: number
	ways: number
	relations: number
}
