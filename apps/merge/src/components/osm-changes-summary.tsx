import type { OsmChange } from "@osmix/change"
import type { OsmEntity } from "@osmix/shared/types"
import { getEntityType } from "@osmix/shared/utils"
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

/**
 * Displays augmented diff content for a change.
 * Shows old/new comparison for modify operations and old state for deletions.
 */
function AugmentedDiffContent({ change }: { change: OsmChange }) {
	const { changeType, entity, oldEntity, refs } = change

	return (
		<>
			{refs && (
				<div className="p-2 border-b-1">
					Related: {refs.map((ref) => `${ref.type} ${ref.id}`).join(", ")}
				</div>
			)}
			{changeType === "modify" && oldEntity ? (
				<div className="grid grid-cols-2">
					<div className="border-r">
						<div className="px-2 py-1 font-bold text-muted-foreground bg-red-50">
							OLD
						</div>
						<div className="w-full overflow-scroll shadow-inner">
							<EntityContent entity={oldEntity} />
						</div>
					</div>
					<div>
						<div className="px-2 py-1 font-bold text-muted-foreground bg-green-50">
							NEW
						</div>
						<div className="w-full overflow-scroll shadow-inner">
							<EntityContent entity={entity} />
						</div>
					</div>
				</div>
			) : changeType === "delete" && oldEntity ? (
				<div>
					<div className="px-2 py-1 font-bold text-muted-foreground bg-red-50">
						DELETED
					</div>
					<EntityContent entity={oldEntity} />
				</div>
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
