import type { Osm, OsmEntity, OsmNode, OsmRelation, OsmWay } from "osm.ts"
import { Details, DetailsContent, DetailsSummary } from "./details"
import { isNode, isRelation, isWay } from "osm.ts/utils"
import { Fragment } from "react/jsx-runtime"

const noop = (_: OsmNode) => undefined

export default function EntityDetails({
	open,
	entity,
	onSelect,
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
				{osm ? (
					<NodeList
						nodes={entity.refs
							.map((ref) => osm.nodes.getById(ref))
							.filter((n) => n != null)}
						onSelect={onSelect ?? noop}
					/>
				) : (
					<tbody>
						<tr>
							<td>refs</td>
							<td>{entity.refs.join(", ")}</td>
						</tr>
					</tbody>
				)}
			</WayDetails>
		)
	if (isRelation(entity))
		return <RelationDetails relation={entity} open={open} />
}

export function NodeDetails({ node, open }: { node: OsmNode; open?: boolean }) {
	return (
		<Details open={open}>
			<DetailsSummary className="font-bold">NODE {node.id}</DetailsSummary>
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
	children,
	open,
}: {
	way: OsmWay
	children: React.ReactNode
	open?: boolean
}) {
	return (
		<Details open={open}>
			<DetailsSummary>WAY {way.id}</DetailsSummary>
			<DetailsContent>
				<table className="w-full">
					<tbody>
						<TagList tags={way.tags} />
					</tbody>
				</table>
				{children}
			</DetailsContent>
		</Details>
	)
}

export function RelationDetails({
	relation,
	open,
}: { relation: OsmRelation; open?: boolean }) {
	return (
		<Details open={open}>
			<DetailsSummary>RELATION {relation.id}</DetailsSummary>
			<DetailsContent>
				<table className="w-full">
					<tbody>
						<tr>
							<td colSpan={2}>members</td>
						</tr>
						{relation.members.map((m) => (
							<tr key={m.ref}>
								<td>
									{m.type}: {m.ref}
								</td>
								<td>{m.role}</td>
							</tr>
						))}
						<TagList tags={relation.tags} />
					</tbody>
				</table>
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
			<DetailsSummary>NODES ({nodes.length})</DetailsSummary>
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
