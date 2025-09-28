import type { Osm, OsmEntity, OsmNode, OsmRelation, OsmWay } from "osm.ts"
import { isNode, isRelation, isWay } from "osm.ts/utils"
import { Fragment } from "react/jsx-runtime"
import { Details, DetailsContent, DetailsSummary } from "./details"

const noop = (_: OsmNode) => undefined

export default function EntityDetails({
	open,
	entity,
	onSelect = noop,
	osm,
}: {
	open?: boolean
	entity: OsmEntity
	onSelect?: (node: OsmNode) => void
	osm?: Osm
}) {
	if (isNode(entity)) return <NodeDetails node={entity} open={open} />
	if (isWay(entity))
		return (
			<WayDetails way={entity} open={open}>
				{osm && (
					<Details open={open}>
						<DetailsSummary>WAY NODES ({entity.refs.length})</DetailsSummary>
						<DetailsContent>
							<NodeListTable
								nodes={entity.refs
									.map((ref) => osm.nodes.getById(ref))
									.filter((n) => n != null)}
								onSelect={onSelect}
							/>
						</DetailsContent>
					</Details>
				)}
			</WayDetails>
		)
	if (isRelation(entity))
		return <RelationDetails relation={entity} open={open} />
}

export function EntityContent({ entity }: { entity: OsmEntity }) {
	if (isNode(entity)) return <NodeContent node={entity} />
	if (isWay(entity)) return <WayContent way={entity} />
	if (isRelation(entity)) return <RelationDetails relation={entity} />
}

export function NodeDetails({ node, open }: { node: OsmNode; open?: boolean }) {
	return (
		<Details open={open}>
			<DetailsSummary className="font-bold">NODE {node.id}</DetailsSummary>
			<DetailsContent>
				<NodeContent node={node} />
			</DetailsContent>
		</Details>
	)
}

export function NodeContent({ node }: { node: OsmNode }) {
	return (
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
	)
}

export function WayContent({ way }: { way: OsmWay }) {
	return (
		<table className="w-full">
			<tbody>
				<tr>
					<td>refs</td>
					<td>{way.refs.join(",")}</td>
				</tr>
				<TagList tags={way.tags} />
			</tbody>
		</table>
	)
}

export function WayDetails({
	way,
	children,
	open,
}: {
	way: OsmWay
	children?: React.ReactNode
	open?: boolean
}) {
	return (
		<Details open={open}>
			<DetailsSummary>WAY {way.id}</DetailsSummary>
			<DetailsContent>
				<WayContent way={way} />
				{children}
			</DetailsContent>
		</Details>
	)
}

export function RelationContent({ relation }: { relation: OsmRelation }) {
	return (
		<table className="w-full">
			<tbody>
				<tr>
					<td>members</td>
					<td>{relation.members.join(",")}</td>
				</tr>
				<TagList tags={relation.tags} />
			</tbody>
		</table>
	)
}

export function RelationDetails({
	relation,
	open,
}: {
	relation: OsmRelation
	open?: boolean
}) {
	return (
		<Details open={open}>
			<DetailsSummary>RELATION {relation.id}</DetailsSummary>
			<DetailsContent>
				<RelationContent relation={relation} />
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

export function NodeListDetails({
	nodes,
	onSelect,
}: {
	nodes: OsmNode[]
	onSelect: (node: OsmNode) => void
}) {
	return (
		<Details open>
			<DetailsSummary>NODES ({nodes.length})</DetailsSummary>
			<DetailsContent className="max-h-48 overflow-y-scroll">
				<NodeListTable nodes={nodes} onSelect={onSelect} />
			</DetailsContent>
		</Details>
	)
}

function NodeListTable({
	nodes,
	onSelect,
}: {
	nodes: OsmNode[]
	onSelect: (node: OsmNode) => void
}) {
	return (
		<table className="table-auto">
			<tbody>
				{nodes.map((node, i) => (
					<Fragment key={`${node.id}-${i}`}>
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
								<tr key={`${node.id}-${k}`}>
									<td />
									<td>{k}</td>
									<td>{String(v)}</td>
								</tr>
							))}
					</Fragment>
				))}
			</tbody>
		</table>
	)
}
