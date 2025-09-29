import { getEntityType, type OsmEntity } from "@osmix/json"
import { Provider, useAtom, useAtomValue, useSetAtom } from "jotai"
import { useHydrateAtoms } from "jotai/utils"
import { ArrowLeft, ArrowRight } from "lucide-react"
import type { OsmChanges } from "osm.ts"
import { cn } from "@/lib/utils"
import {
	changesAtom,
	changesSummaryAtom,
	changeTypeFilterAtom,
	currentChangesAtom,
	DEFAULT_PAGE_SIZE,
	entityTypeFilterAtom,
	pageAtom,
	pageSizeAtom,
	startIndexAtom,
	totalPagesAtom,
} from "@/state/changes"
import { Details, DetailsContent, DetailsSummary } from "./details"
import { EntityContent } from "./entity-details"
import { Button } from "./ui/button"

function HydrateAtoms({
	changes,
	pageSize,
}: {
	changes?: OsmChanges
	pageSize?: number
}) {
	useHydrateAtoms([
		[changesAtom, changes ?? null],
		[pageSizeAtom, pageSize ?? DEFAULT_PAGE_SIZE],
	])
	return null
}

export function ChangesProvider({
	changes,
	children,
	pageSize,
}: {
	changes?: OsmChanges
	children: React.ReactNode
	pageSize?: number
}) {
	return (
		<Provider>
			<HydrateAtoms changes={changes} pageSize={pageSize} />
			{children}
		</Provider>
	)
}

export default function ChangesSummary({
	children,
}: {
	children: React.ReactNode
}) {
	const summary = useAtomValue(changesSummaryAtom)
	if (!summary) return null

	return (
		<div className="flex flex-col gap-2">
			<Details open={true}>
				<DetailsSummary>CHANGES SUMMARY</DetailsSummary>
				<DetailsContent>
					{summary.totalChanges === 0 ? (
						<div className="py-1 px-2">NO CHANGES FOUND</div>
					) : (
						<ChangesSummaryTable />
					)}

					{children}
				</DetailsContent>
			</Details>
		</div>
	)
}

function ChangesSummaryTable() {
	const changes = useAtomValue(changesAtom)
	const summary = useAtomValue(changesSummaryAtom)
	if (!summary || !changes) return null
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
					<td>{changes.stats.deduplicatedNodes.toLocaleString()}</td>
				</tr>
				<tr>
					<td>deduplicated nodes replaced</td>
					<td>{changes.stats.deduplicatedNodesReplaced.toLocaleString()}</td>
				</tr>
				<tr>
					<td>intersection points found</td>
					<td>{changes.stats.intersectionPointsFound.toLocaleString()}</td>
				</tr>
			</tbody>
		</table>
	)
}

export function ChangesFilters() {
	const [changeTypeFilter, setChangeTypeFilter] = useAtom(changeTypeFilterAtom)
	const [entityTypeFilter, setEntityTypeFilter] = useAtom(entityTypeFilterAtom)
	const setPage = useSetAtom(pageAtom)

	return (
		<div className="filters flex gap-3 pl-2 pb-2">
			<label>
				<input
					type="checkbox"
					checked={changeTypeFilter.create}
					onChange={(e) => {
						setPage(0)
						setChangeTypeFilter({
							...changeTypeFilter,
							create: e.target.checked,
						})
					}}
				/>{" "}
				create
			</label>
			<label>
				<input
					type="checkbox"
					checked={changeTypeFilter.modify}
					onChange={(e) => {
						setPage(0)
						setChangeTypeFilter({
							...changeTypeFilter,
							modify: e.target.checked,
						})
					}}
				/>{" "}
				modify
			</label>
			<label>
				<input
					type="checkbox"
					checked={changeTypeFilter.delete}
					onChange={(e) => {
						setPage(0)
						setChangeTypeFilter({
							...changeTypeFilter,
							delete: e.target.checked,
						})
					}}
				/>{" "}
				delete
			</label>
			<label>
				<input
					type="checkbox"
					checked={entityTypeFilter.node}
					onChange={(e) => {
						setPage(0)
						setEntityTypeFilter({
							...entityTypeFilter,
							node: e.target.checked,
						})
					}}
				/>{" "}
				node
			</label>
			<label>
				<input
					type="checkbox"
					checked={entityTypeFilter.way}
					onChange={(e) => {
						setPage(0)
						setEntityTypeFilter({
							...entityTypeFilter,
							way: e.target.checked,
						})
					}}
				/>{" "}
				way
			</label>
			<label>
				<input
					type="checkbox"
					checked={entityTypeFilter.relation}
					onChange={(e) => {
						setPage(0)
						setEntityTypeFilter({
							...entityTypeFilter,
							relation: e.target.checked,
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
	const currentChanges = useAtomValue(currentChangesAtom)
	const startIndex = useAtomValue(startIndexAtom)

	return (
		<div className="flex flex-col">
			{currentChanges.map(({ changeType, entity, refs }, i) => {
				const changeTypeColor = CHANGE_TYPE_COLOR[changeType]
				const entityType = getEntityType(entity)
				return (
					<button
						key={`${entityType}-${entity.id}`}
						className={cn(
							"border-l pl-2 py-0.5 font-bold cursor-pointer w-full text-left select-text",
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

export function ChangesExpandableList() {
	const currentChanges = useAtomValue(currentChangesAtom)
	const startIndex = useAtomValue(startIndexAtom)

	return (
		<div className="flex flex-col">
			{currentChanges.map(({ changeType, entity, refs }, i) => {
				const changeTypeColor = CHANGE_TYPE_COLOR[changeType]
				const entityType = getEntityType(entity)
				const summaryLabel = `${startIndex + i + 1}. ${changeType.toUpperCase()} ${entityType.toUpperCase()} ${entity.id}`
				return (
					<Details key={`${entityType}-${entity.id}`} open={false}>
						<DetailsSummary className={cn(changeTypeColor)}>
							{summaryLabel}
						</DetailsSummary>

						<DetailsContent>
							{refs && (
								<div className="p-1 border-1">
									Related:{" "}
									{refs.map((ref) => `${ref.type} ${ref.id}`).join(", ")}
								</div>
							)}
							<EntityContent entity={entity} />
						</DetailsContent>
					</Details>
				)
			})}
		</div>
	)
}

export function ChangesPagination() {
	const [currentPage, setCurrentPage] = useAtom(pageAtom)
	const totalPages = useAtomValue(totalPagesAtom)
	const goToNextPage = () => {
		if (currentPage < totalPages - 1) {
			setCurrentPage(currentPage + 1)
		}
	}
	const goToPrevPage = () => {
		if (currentPage > 0) {
			setCurrentPage(currentPage - 1)
		}
	}
	return (
		<div className="flex items-center justify-between">
			<Button
				variant="ghost"
				size="sm"
				onClick={goToPrevPage}
				disabled={currentPage <= 0}
			>
				<ArrowLeft className="w-3 h-3 mr-1" />
			</Button>
			<span className="text-xs text-slate-500">
				{(totalPages === 0 ? 0 : currentPage + 1).toLocaleString()} of{" "}
				{totalPages.toLocaleString()}
			</span>
			<Button
				variant="ghost"
				size="sm"
				onClick={goToNextPage}
				disabled={currentPage >= totalPages - 1}
			>
				<ArrowRight className="w-3 h-3 ml-1" />
			</Button>
		</div>
	)
}
