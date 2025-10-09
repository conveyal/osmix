import type { OsmNode, OsmRelation, OsmWay } from "@osmix/json"
import { readOsmPbf } from "@osmix/pbf"
import { Osmix } from "./osmix"
import { throttle } from "./utils"

export interface OsmIndexCreateOptions {
	id?: string
	onProgress?: (message: string) => void
	filterNode?: (node: OsmNode) => boolean
	filterWay?: (way: OsmWay, osm: Osmix) => OsmWay | null
	filterRelation?: (relation: OsmRelation, osm: Osmix) => OsmRelation | null
}

const DEFAULT_PROGRESS = console.log

export async function createOsmIndexFromPbfData(
	data: ArrayBufferLike | ReadableStream<ArrayBufferLike>,
	options: OsmIndexCreateOptions = {},
) {
	const id = options.id
	const onProgress = options.onProgress ?? DEFAULT_PROGRESS

	const { header, blocks } = await readOsmPbf(data)
	const osm = new Osmix(id, header)
	const logEverySecond = throttle(onProgress, 1_000)

	let stage: "nodes" | "ways" | "relations" = "nodes"
	let entityCount = 0

	const finishNodes = () => {
		onProgress(
			`Loaded ${osm.nodes.size.toLocaleString()} nodes. Sorting node IDs...`,
		)
		osm.nodes.finish()
		stage = "ways"
		entityCount = 0
	}
	const finishWays = () => {
		onProgress(
			`Loaded ${osm.ways.size.toLocaleString()} ways. Sorting way IDs...`,
		)
		osm.ways.finish()
		stage = "relations"
		entityCount = 0
	}
	const finishRelations = () => {
		onProgress(
			`Loaded ${osm.relations.size.toLocaleString()} relations. Sorting relation IDs...`,
		)
		osm.relations.finish()
	}

	const { filterWay: optsFilterWay, filterRelation: optsFilterRelation } =
		options
	const filterWay = optsFilterWay
		? (way: OsmWay) => optsFilterWay(way, osm)
		: undefined
	const filterRelation = optsFilterRelation
		? (relation: OsmRelation) => optsFilterRelation(relation, osm)
		: undefined

	for await (const block of blocks) {
		const blockStringIndexMap = osm.stringTable.createBlockIndexMap(block)

		for (const group of block.primitivegroup) {
			const { nodes, ways, relations, dense } = group

			if (nodes && nodes.length > 0) {
				throw Error("Nodes must be dense!")
			}

			if (dense) {
				const addedDense = osm.nodes.addDenseNodes(
					dense,
					block,
					blockStringIndexMap,
					options.filterNode,
				)
				if (addedDense > 0) {
					entityCount += addedDense
					logEverySecond(`${entityCount.toLocaleString()} nodes loaded`)
				}
			}

			if (ways.length > 0) {
				if (osm.ways.size === 0) {
					finishNodes()
				}
				const addedWays = osm.ways.addWays(ways, blockStringIndexMap, filterWay)
				if (addedWays > 0) {
					entityCount += addedWays
					logEverySecond(`${entityCount.toLocaleString()} ways loaded`)
				}
			}

			if (relations.length > 0) {
				if (osm.relations.size === 0) {
					finishWays()
				}
				const addedRelations = osm.relations.addRelations(
					relations,
					blockStringIndexMap,
					filterRelation,
				)
				if (addedRelations > 0) {
					entityCount += addedRelations
					logEverySecond(`${entityCount.toLocaleString()} relations loaded`)
				}
			}

			logEverySecond(`${entityCount.toLocaleString()} ${stage} processed`)
		}
	}

	if (osm.ways.size === 0 && osm.relations.size === 0) {
		finishNodes()
	} else if (osm.relations.size === 0) {
		finishWays()
	} else {
		finishRelations()
	}

	onProgress("Building spatial indexes for nodes and ways...")
	osm.finish()
	onProgress(
		`Added ${osm.nodes.size.toLocaleString()} nodes, ${osm.ways.size.toLocaleString()} ways, and ${osm.relations.size.toLocaleString()} relations.`,
	)

	return osm
}
