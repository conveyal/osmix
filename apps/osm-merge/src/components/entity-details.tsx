import type { Osm, OsmNode, OsmWay } from "osm.ts"
import { Details, DetailsContent, DetailsSummary } from "./details"
import { isNode, isWay } from "osm.ts/utils"
import { Fragment } from "react/jsx-runtime"

const noop = (_: OsmNode) => undefined

export default function EntityDetails({
	entity,
	onSelect,
	osm,
}: {
	entity: OsmNode | OsmWay
	onSelect?: (node: OsmNode) => void
	osm: Osm
}) {
	if (isNode(entity)) return <NodeDetails node={entity} />
	if (isWay(entity))
		return (
			<WayDetails
				way={entity}
				nodes={entity.refs
					.map((ref) => osm.nodes.getById(ref))
					.filter((n) => n != null)}
				onSelect={onSelect ?? noop}
			/>
		)
}

export function NodeDetails({ node }: { node: OsmNode }) {
	return (
		<Details open>
			<DetailsSummary className="font-bold p-1">NODE {node.id}</DetailsSummary>
			<DetailsContent>
				<table className="w-full">
					<tbody>
						<tr>
							<td>lon</td>
							<td>{node.lon}</td>
						</tr>
						<tr>
							<td>lat</td>
							<td>{node.lat}</td>
						</tr>
						<TagList tags={node.tags} />
					</tbody>
				</table>
			</DetailsContent>
		</Details>
	)
}

export function WayDetails({
	way,
	nodes,
	onSelect,
}: {
	way: OsmWay
	nodes: OsmNode[]
	onSelect: (node: OsmNode) => void
}) {
	return (
		<Details open>
			<DetailsSummary className="font-bold p-1">WAY {way.id}</DetailsSummary>
			<DetailsContent>
				<table className="w-full">
					<tbody>
						<TagList tags={way.tags} />
					</tbody>
				</table>
				<NodeList onSelect={onSelect} nodes={nodes} />
			</DetailsContent>
		</Details>
	)
}

export function TagList({ tags }: { tags?: Record<string, unknown> }) {
	const entries = Object.entries(tags || {})
	if (entries.length === 0) return null
	return (
		<>
			{entries.map(([k, v]) => (
				<tr key={k}>
					<td>{k}</td>
					<td>{String(v)}</td>
				</tr>
			))}
		</>
	)
}

export function NodeList({
	nodes,
	onSelect,
}: { nodes: OsmNode[]; onSelect: (node: OsmNode) => void }) {
	return (
		<Details open>
			<DetailsSummary className="p-1 font-bold">
				NODES ({nodes.length})
			</DetailsSummary>
			<DetailsContent className="max-h-48 overflow-y-scroll">
				<table className="table-auto">
					<tbody>
						{nodes.map((node, i) => (
							<Fragment key={node.id}>
								<tr
									onClick={() => onSelect(node)}
									onKeyDown={() => onSelect(node)}
									className="cursor-pointer"
								>
									<td>{i + 1}</td>
									<td>{node.id}</td>
									<td>
										{node.lon}, {node.lat}
									</td>
								</tr>
								{node.tags &&
									Object.entries(node.tags).map(([k, v]) => (
										<tr key={k}>
											<td />
											<td>{k}</td>
											<td>{String(v)}</td>
										</tr>
									))}
							</Fragment>
						))}
					</tbody>
				</table>
			</DetailsContent>
		</Details>
	)
}
