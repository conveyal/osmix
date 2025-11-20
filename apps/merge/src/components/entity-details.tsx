import type { Osm } from "@osmix/core"
import { getRelationKindMetadata } from "@osmix/shared/relation-kind"
import type {
	OsmEntity,
	OsmNode,
	OsmRelation,
	OsmWay,
} from "@osmix/shared/types"
import { isNode, isRelation, isWay } from "@osmix/shared/utils"
import type { ReactNode } from "react"
import { Fragment } from "react/jsx-runtime"
import { Details, DetailsContent, DetailsSummary } from "./details"

const noop = (_: OsmEntity) => undefined

export default function EntityDetails({
	open,
	entity,
	onSelect = noop,
	osm,
}: {
	open?: boolean
	entity: OsmEntity
	onSelect?: (entity: OsmEntity) => void
	osm?: Osm
}) {
	if (isNode(entity)) return <NodeDetails node={entity} open={open} />
	if (isWay(entity))
		return (
			<WayDetails way={entity} open={open}>
				{osm && (
					<Details open={false}>
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
		return (
			<RelationDetails relation={entity} open={open}>
				{osm && (
					<Details open={false}>
						<DetailsSummary>
							RELATION MEMBERS ({entity.members.length})
						</DetailsSummary>
						<DetailsContent>
							<RelationMemberListTable
								members={entity.members}
								osm={osm}
								onSelect={onSelect}
							/>
						</DetailsContent>
					</Details>
				)}
			</RelationDetails>
		)
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
	const kindMetadata = getRelationKindMetadata(relation)
	const relationMemberCount = relation.members.filter(
		(m) => m.type === "relation",
	).length

	return (
		<table className="w-full">
			<tbody>
				<tr>
					<td>kind</td>
					<td>{kindMetadata.kind}</td>
				</tr>
				{kindMetadata.description && (
					<tr>
						<td>description</td>
						<td>{kindMetadata.description}</td>
					</tr>
				)}
				{relationMemberCount > 0 && (
					<tr>
						<td>nested relations</td>
						<td>{relationMemberCount}</td>
					</tr>
				)}
				<TagList tags={relation.tags} />
			</tbody>
		</table>
	)
}

export function RelationDetails({
	relation,
	children,
	open,
}: {
	relation: OsmRelation
	children?: ReactNode
	open?: boolean
}) {
	return (
		<Details open={open}>
			<DetailsSummary className="font-bold">
				RELATION {relation.id}
			</DetailsSummary>
			<DetailsContent>
				<RelationContent relation={relation} />
				{children}
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

function RelationMemberListTable({
	members,
	osm,
	onSelect,
}: {
	members: OsmRelation["members"]
	osm: Osm
	onSelect: (entity: OsmEntity) => void
}) {
	return (
		<table className="table-auto">
			<tbody>
				{members.map((member, i) => {
					let entity: OsmEntity | null = null
					if (member.type === "node") {
						entity = osm.nodes.getById(member.ref)
					} else if (member.type === "way") {
						entity = osm.ways.getById(member.ref)
					} else if (member.type === "relation") {
						entity = osm.relations.getById(member.ref)
					}

					return (
						<Fragment key={`${member.type}-${member.ref}-${i}`}>
							<tr
								onClick={() => entity && onSelect(entity)}
								onKeyDown={() => entity && onSelect(entity)}
								className={entity ? "cursor-pointer" : ""}
							>
								<td>{i + 1}</td>
								<td>{member.type}</td>
								<td>{member.ref}</td>
								<td>{member.role || ""}</td>
								{member.type === "node" && entity && (
									<td>
										{(entity as OsmNode).lon}, {(entity as OsmNode).lat}
									</td>
								)}
								{member.type === "way" && entity && (
									<td>{(entity as OsmWay).refs.length} nodes</td>
								)}
								{member.type === "relation" && entity && (
									<td>{(entity as OsmRelation).members.length} members</td>
								)}
								{!entity && <td className="text-gray-500">not found</td>}
							</tr>
							{entity?.tags &&
								Object.entries(entity.tags).map(([k, v]) => (
									<tr key={`${member.type}-${member.ref}-${k}`}>
										<td />
										<td />
										<td>{k}</td>
										<td colSpan={2}>{String(v)}</td>
									</tr>
								))}
						</Fragment>
					)
				})}
			</tbody>
		</table>
	)
}
