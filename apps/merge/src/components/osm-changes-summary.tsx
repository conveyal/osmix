import type { OsmChange } from "@osmix/change"
import type {
	OsmEntity,
	OsmNode,
	OsmRelation,
	OsmWay,
} from "@osmix/shared/types"
import { getEntityType, isNode, isRelation, isWay } from "@osmix/shared/utils"
import { useAtom, useAtomValue, useSetAtom } from "jotai"
import { ArrowLeft, ArrowRight } from "lucide-react"
import { useTransition } from "react"
import { cn } from "../lib/utils"
import {
	changesAtom,
	changesetStatsAtom,
	changeTypeFilterAtom,
	entityTypeFilterAtom,
	pageAtom,
	startIndexAtom,
} from "../state/changes"
import { Details, DetailsContent, DetailsSummary } from "./details"
import { EntityContent } from "./entity-details"
import { Button } from "./ui/button"

export default function ChangesSummary() {
	return (
		<Details>
			<DetailsSummary>SUMMARY</DetailsSummary>
			<DetailsContent>
				<ChangesSummaryTable />
			</DetailsContent>
		</Details>
	)
}

function ChangesSummaryTable() {
	const summary = useAtomValue(changesetStatsAtom)
	if (!summary || summary.totalChanges === 0)
		return <div className="py-1 px-2">NO CHANGES FOUND</div>
	return (
		<table>
			<tbody>
				<tr>
					<td>total changes</td>
					<td>{summary.totalChanges.toLocaleString()}</td>
				</tr>
				<tr>
					<td>node changes</td>
					<td>{summary.nodeChanges.toLocaleString()}</td>
				</tr>
				<tr>
					<td>way changes</td>
					<td>{summary.wayChanges.toLocaleString()}</td>
				</tr>
				<tr>
					<td>relation changes</td>
					<td>{summary.relationChanges.toLocaleString()}</td>
				</tr>

				<tr>
					<td>deduplicated nodes</td>
					<td>{summary.deduplicatedNodes.toLocaleString()}</td>
				</tr>
				<tr>
					<td>deduplicated nodes replaced</td>
					<td>{summary.deduplicatedNodesReplaced.toLocaleString()}</td>
				</tr>
				<tr>
					<td>intersection points found</td>
					<td>{summary.intersectionPointsFound.toLocaleString()}</td>
				</tr>
			</tbody>
		</table>
	)
}

export function ChangesFilters() {
	const [changeTypeFilter, setChangeTypeFilter] = useAtom(changeTypeFilterAtom)
	const [entityTypeFilter, setEntityTypeFilter] = useAtom(entityTypeFilterAtom)
	const setPage = useSetAtom(pageAtom)
	const [, startTransition] = useTransition()

	return (
		<div className="filters flex justify-between px-2 py-2">
			<label>
				<input
					type="checkbox"
					checked={changeTypeFilter.includes("create")}
					onChange={(e) => {
						startTransition(() => {
							setPage(0)
							if (e.target.checked) {
								setChangeTypeFilter([...changeTypeFilter, "create"])
							} else {
								setChangeTypeFilter(
									changeTypeFilter.filter((type) => type !== "create"),
								)
							}
						})
					}}
				/>{" "}
				create
			</label>
			<label>
				<input
					type="checkbox"
					checked={changeTypeFilter.includes("modify")}
					onChange={(e) => {
						startTransition(() => {
							setPage(0)
							if (e.target.checked) {
								setChangeTypeFilter([...changeTypeFilter, "modify"])
							} else {
								setChangeTypeFilter(
									changeTypeFilter.filter((type) => type !== "modify"),
								)
							}
						})
					}}
				/>{" "}
				modify
			</label>
			<label>
				<input
					type="checkbox"
					checked={changeTypeFilter.includes("delete")}
					onChange={(e) => {
						startTransition(() => {
							setPage(0)
							if (e.target.checked) {
								setChangeTypeFilter([...changeTypeFilter, "delete"])
							} else {
								setChangeTypeFilter(
									changeTypeFilter.filter((type) => type !== "delete"),
								)
							}
						})
					}}
				/>{" "}
				delete
			</label>
			<label>
				<input
					type="checkbox"
					checked={entityTypeFilter.includes("node")}
					onChange={(e) => {
						startTransition(() => {
							setPage(0)
							if (e.target.checked) {
								setEntityTypeFilter([...entityTypeFilter, "node"])
							} else {
								setEntityTypeFilter(
									entityTypeFilter.filter((type) => type !== "node"),
								)
							}
						})
					}}
				/>{" "}
				node
			</label>
			<label>
				<input
					type="checkbox"
					checked={entityTypeFilter.includes("way")}
					onChange={(e) => {
						startTransition(() => {
							setPage(0)
							if (e.target.checked) {
								setEntityTypeFilter([...entityTypeFilter, "way"])
							} else {
								setEntityTypeFilter(
									entityTypeFilter.filter((type) => type !== "way"),
								)
							}
						})
					}}
				/>{" "}
				way
			</label>
			<label>
				<input
					type="checkbox"
					checked={entityTypeFilter.includes("relation")}
					onChange={(e) => {
						startTransition(() => {
							setPage(0)
							if (e.target.checked) {
								setEntityTypeFilter([...entityTypeFilter, "relation"])
							} else {
								setEntityTypeFilter(
									entityTypeFilter.filter((type) => type !== "relation"),
								)
							}
						})
					}}
				/>{" "}
				relation
			</label>
		</div>
	)
}

const CHANGE_TYPE_COLOR = {
	create: "text-green-600",
	modify: "text-yellow-600",
	delete: "text-red-600",
}

export function ChangesList({
	setSelectedEntity,
}: {
	setSelectedEntity: (entity: OsmEntity) => void
}) {
	const changes = useAtomValue(changesAtom)?.changes
	const startIndex = useAtomValue(startIndexAtom)

	return (
		<div className="flex flex-col">
			{changes?.map(({ changeType, entity, refs }, i) => {
				const changeTypeColor = CHANGE_TYPE_COLOR[changeType]
				const entityType = getEntityType(entity)
				return (
					<button
						key={`${entityType}-${entity.id}`}
						className={cn(
							"pl-2 py-1 font-bold cursor-pointer w-full text-left select-text hover:bg-accent",
							changeTypeColor,
						)}
						onClick={() => setSelectedEntity(entity)}
						type="button"
						tabIndex={0}
					>
						{startIndex + i + 1}. {changeType.toUpperCase()}{" "}
						{entityType.toUpperCase()} {entity.id}{" "}
						{refs &&
							`(${refs.map((ref) => `${ref.type} ${ref.id}`).join(", ")})`}
					</button>
				)
			})}
		</div>
	)
}

type DiffStatus = "added" | "removed" | "modified" | "unchanged"

/**
 * Renders a table row with diff highlighting.
 */
function DiffRow({
	label,
	oldValue,
	newValue,
	status,
}: {
	label: string
	oldValue?: string
	newValue?: string
	status: DiffStatus
}) {
	return (
		<tr
			className={cn(
				status === "added" && "bg-green-50",
				status === "removed" && "bg-red-50",
				status === "modified" && "bg-yellow-50",
			)}
		>
			<td className="align-top">{label}</td>
			<td>
				{status === "removed" ? (
					<span className="text-red-600 line-through">{oldValue}</span>
				) : status === "added" ? (
					<span className="text-green-600">{newValue}</span>
				) : status === "modified" ? (
					<>
						<span className="text-red-600 line-through">{oldValue}</span>
						<span className="mx-1">→</span>
						<span className="text-green-600">{newValue}</span>
					</>
				) : (
					<span>{newValue}</span>
				)}
			</td>
		</tr>
	)
}

/**
 * Computes and displays a unified diff for tags.
 */
function TagsDiff({
	oldTags,
	newTags,
}: {
	oldTags?: Record<string, unknown>
	newTags?: Record<string, unknown>
}) {
	const old = oldTags ?? {}
	const current = newTags ?? {}
	const allKeys = new Set([...Object.keys(old), ...Object.keys(current)])

	const rows: Array<{
		key: string
		status: DiffStatus
		oldValue?: string
		newValue?: string
	}> = []

	for (const key of allKeys) {
		const oldVal = old[key] !== undefined ? String(old[key]) : undefined
		const newVal = current[key] !== undefined ? String(current[key]) : undefined

		if (oldVal === undefined && newVal !== undefined) {
			rows.push({ key, status: "added", newValue: newVal })
		} else if (oldVal !== undefined && newVal === undefined) {
			rows.push({ key, status: "removed", oldValue: oldVal })
		} else if (oldVal !== newVal) {
			rows.push({ key, status: "modified", oldValue: oldVal, newValue: newVal })
		} else {
			rows.push({ key, status: "unchanged", newValue: newVal })
		}
	}

	// Sort: modified first, then added, then removed, then unchanged
	const statusOrder: Record<DiffStatus, number> = {
		modified: 0,
		added: 1,
		removed: 2,
		unchanged: 3,
	}
	rows.sort((a, b) => statusOrder[a.status] - statusOrder[b.status])

	return (
		<>
			{rows.map((row) => (
				<DiffRow
					key={row.key}
					label={row.key}
					oldValue={row.oldValue}
					newValue={row.newValue}
					status={row.status}
				/>
			))}
		</>
	)
}

/**
 * Displays a unified diff for a node entity.
 */
function NodeDiff({
	oldNode,
	newNode,
}: {
	oldNode: OsmNode
	newNode: OsmNode
}) {
	const lonChanged = oldNode.lon !== newNode.lon
	const latChanged = oldNode.lat !== newNode.lat

	return (
		<table className="w-full">
			<tbody>
				<DiffRow
					label="lon"
					oldValue={String(oldNode.lon)}
					newValue={String(newNode.lon)}
					status={lonChanged ? "modified" : "unchanged"}
				/>
				<DiffRow
					label="lat"
					oldValue={String(oldNode.lat)}
					newValue={String(newNode.lat)}
					status={latChanged ? "modified" : "unchanged"}
				/>
				<TagsDiff oldTags={oldNode.tags} newTags={newNode.tags} />
			</tbody>
		</table>
	)
}

/**
 * Displays a unified diff for a way entity.
 */
function WayDiff({ oldWay, newWay }: { oldWay: OsmWay; newWay: OsmWay }) {
	const oldRefs = oldWay.refs.join(",")
	const newRefs = newWay.refs.join(",")
	const refsChanged = oldRefs !== newRefs

	return (
		<table className="w-full">
			<tbody>
				<DiffRow
					label="refs"
					oldValue={oldRefs}
					newValue={newRefs}
					status={refsChanged ? "modified" : "unchanged"}
				/>
				<TagsDiff oldTags={oldWay.tags} newTags={newWay.tags} />
			</tbody>
		</table>
	)
}

/**
 * Displays a unified diff for a relation entity.
 */
function RelationDiff({
	oldRelation,
	newRelation,
}: {
	oldRelation: OsmRelation
	newRelation: OsmRelation
}) {
	const formatMembers = (members: OsmRelation["members"]) =>
		members
			.map((m) => `${m.type}:${m.ref}${m.role ? `(${m.role})` : ""}`)
			.join(", ")

	const oldMembers = formatMembers(oldRelation.members)
	const newMembers = formatMembers(newRelation.members)
	const membersChanged = oldMembers !== newMembers

	return (
		<table className="w-full">
			<tbody>
				<DiffRow
					label="members"
					oldValue={oldMembers}
					newValue={newMembers}
					status={membersChanged ? "modified" : "unchanged"}
				/>
				<TagsDiff oldTags={oldRelation.tags} newTags={newRelation.tags} />
			</tbody>
		</table>
	)
}

/**
 * Displays a unified diff for any entity type.
 */
function EntityDiff({
	oldEntity,
	newEntity,
}: {
	oldEntity: OsmEntity
	newEntity: OsmEntity
}) {
	if (isNode(oldEntity) && isNode(newEntity)) {
		return <NodeDiff oldNode={oldEntity} newNode={newEntity} />
	}
	if (isWay(oldEntity) && isWay(newEntity)) {
		return <WayDiff oldWay={oldEntity} newWay={newEntity} />
	}
	if (isRelation(oldEntity) && isRelation(newEntity)) {
		return <RelationDiff oldRelation={oldEntity} newRelation={newEntity} />
	}
	// Fallback
	return <EntityContent entity={newEntity} />
}

/**
 * Displays a deleted entity with all properties shown as removed.
 */
function DeletedEntityContent({ entity }: { entity: OsmEntity }) {
	if (isNode(entity)) {
		return (
			<table className="w-full">
				<tbody>
					<DiffRow label="lon" oldValue={String(entity.lon)} status="removed" />
					<DiffRow label="lat" oldValue={String(entity.lat)} status="removed" />
					{entity.tags &&
						Object.entries(entity.tags).map(([k, v]) => (
							<DiffRow
								key={k}
								label={k}
								oldValue={String(v)}
								status="removed"
							/>
						))}
				</tbody>
			</table>
		)
	}
	if (isWay(entity)) {
		return (
			<table className="w-full">
				<tbody>
					<DiffRow
						label="refs"
						oldValue={entity.refs.join(",")}
						status="removed"
					/>
					{entity.tags &&
						Object.entries(entity.tags).map(([k, v]) => (
							<DiffRow
								key={k}
								label={k}
								oldValue={String(v)}
								status="removed"
							/>
						))}
				</tbody>
			</table>
		)
	}
	if (isRelation(entity)) {
		const formatMembers = (members: OsmRelation["members"]) =>
			members
				.map((m) => `${m.type}:${m.ref}${m.role ? `(${m.role})` : ""}`)
				.join(", ")
		return (
			<table className="w-full">
				<tbody>
					<DiffRow
						label="members"
						oldValue={formatMembers(entity.members)}
						status="removed"
					/>
					{entity.tags &&
						Object.entries(entity.tags).map(([k, v]) => (
							<DiffRow
								key={k}
								label={k}
								oldValue={String(v)}
								status="removed"
							/>
						))}
				</tbody>
			</table>
		)
	}
	return <EntityContent entity={entity} />
}

/**
 * Displays a created entity with all properties shown as added.
 */
function CreatedEntityContent({ entity }: { entity: OsmEntity }) {
	if (isNode(entity)) {
		return (
			<table className="w-full">
				<tbody>
					<DiffRow label="lon" newValue={String(entity.lon)} status="added" />
					<DiffRow label="lat" newValue={String(entity.lat)} status="added" />
					{entity.tags &&
						Object.entries(entity.tags).map(([k, v]) => (
							<DiffRow key={k} label={k} newValue={String(v)} status="added" />
						))}
				</tbody>
			</table>
		)
	}
	if (isWay(entity)) {
		return (
			<table className="w-full">
				<tbody>
					<DiffRow
						label="refs"
						newValue={entity.refs.join(",")}
						status="added"
					/>
					{entity.tags &&
						Object.entries(entity.tags).map(([k, v]) => (
							<DiffRow key={k} label={k} newValue={String(v)} status="added" />
						))}
				</tbody>
			</table>
		)
	}
	if (isRelation(entity)) {
		const formatMembers = (members: OsmRelation["members"]) =>
			members
				.map((m) => `${m.type}:${m.ref}${m.role ? `(${m.role})` : ""}`)
				.join(", ")
		return (
			<table className="w-full">
				<tbody>
					<DiffRow
						label="members"
						newValue={formatMembers(entity.members)}
						status="added"
					/>
					{entity.tags &&
						Object.entries(entity.tags).map(([k, v]) => (
							<DiffRow key={k} label={k} newValue={String(v)} status="added" />
						))}
				</tbody>
			</table>
		)
	}
	return <EntityContent entity={entity} />
}

/**
 * Displays augmented diff content for a change.
 * Shows a unified diff with additions, deletions, and modifications highlighted.
 */
function AugmentedDiffContent({ change }: { change: OsmChange }) {
	const { changeType, entity, oldEntity, refs } = change

	return (
		<>
			{refs && (
				<div className="p-2 border-b">
					Related: {refs.map((ref) => `${ref.type} ${ref.id}`).join(", ")}
				</div>
			)}
			{changeType === "modify" && oldEntity ? (
				<EntityDiff oldEntity={oldEntity} newEntity={entity} />
			) : changeType === "delete" && oldEntity ? (
				<DeletedEntityContent entity={oldEntity} />
			) : changeType === "create" ? (
				<CreatedEntityContent entity={entity} />
			) : (
				<EntityContent entity={entity} />
			)}
		</>
	)
}

export function ChangesExpandableList() {
	const changes = useAtomValue(changesAtom)?.changes
	const startIndex = useAtomValue(startIndexAtom)

	return (
		<div className="flex flex-col">
			{changes?.map((change, i) => {
				const { changeType, entity } = change
				const changeTypeColor = CHANGE_TYPE_COLOR[changeType]
				const entityType = getEntityType(entity)
				const summaryLabel = `${startIndex + i + 1}. ${changeType.toUpperCase()} ${entityType.toUpperCase()} ${entity.id}`
				return (
					<Details key={`${entityType}-${entity.id}`} defaultOpen={false}>
						<DetailsSummary className={cn(changeTypeColor)}>
							{summaryLabel}
						</DetailsSummary>

						<DetailsContent className="w-full overflow-scroll inset-shadow">
							<AugmentedDiffContent change={change} />
						</DetailsContent>
					</Details>
				)
			})}
		</div>
	)
}

export function ChangesPagination() {
	const [currentPage, setCurrentPage] = useAtom(pageAtom)
	const totalPages = useAtomValue(changesAtom)?.totalPages ?? 0
	const [, startTransition] = useTransition()
	const goToNextPage = () => {
		startTransition(() => {
			if (currentPage < totalPages - 1) {
				setCurrentPage(currentPage + 1)
			}
		})
	}
	const goToPrevPage = () => {
		startTransition(() => {
			if (currentPage > 0) {
				setCurrentPage(currentPage - 1)
			}
		})
	}
	return (
		<div className="flex items-center justify-between">
			<Button
				variant="ghost"
				size="icon-sm"
				onClick={goToPrevPage}
				disabled={currentPage <= 0}
			>
				<ArrowLeft />
			</Button>
			<span className="text-slate-500">
				{(totalPages === 0 ? 0 : currentPage + 1).toLocaleString()} of{" "}
				{totalPages.toLocaleString()}
			</span>
			<Button
				variant="ghost"
				size="icon-sm"
				onClick={goToNextPage}
				disabled={currentPage >= totalPages - 1}
			>
				<ArrowRight />
			</Button>
		</div>
	)
}
