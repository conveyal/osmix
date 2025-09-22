import { cn } from "@/lib/utils"
import {
	DEFAULT_PAGE_SIZE,
	changeTypeFilterAtom,
	changesAtom,
	currentChangesAtom,
	entityTypeFilterAtom,
	pageAtom,
	pageSizeAtom,
	startIndexAtom,
	totalPagesAtom,
} from "@/state/changes"
import { Provider, useAtom, useAtomValue, useSetAtom } from "jotai"
import { useHydrateAtoms } from "jotai/utils"
import { ArrowLeft, ArrowRight } from "lucide-react"
import { type OsmChanges, type OsmEntity, getEntityType } from "osm.ts"
import { Details, DetailsContent, DetailsSummary } from "./details"
import EntityDetails, { EntityContent } from "./entity-details"
import { Button } from "./ui/button"

function HydrateAtoms({
	changes,
	pageSize,
}: { changes?: OsmChanges; pageSize?: number }) {
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
}: { changes?: OsmChanges; children: React.ReactNode; pageSize?: number }) {
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
	const changes = useAtomValue(changesAtom)
	if (!changes) return null

	const nodeChanges = Object.keys(changes.nodes).length
	const wayChanges = Object.keys(changes.ways).length
	const relationChanges = Object.keys(changes.relations).length
	const totalChanges = nodeChanges + wayChanges + relationChanges

	return (
		<div className="flex flex-col gap-2">
			<Details open={true}>
				<DetailsSummary>CHANGES SUMMARY</DetailsSummary>
				<DetailsContent>
					<table>
						<tbody>
							<tr>
								<td>node changes</td>
								<td>{nodeChanges.toLocaleString()}</td>
							</tr>
							<tr>
								<td>way changes</td>
								<td>{wayChanges.toLocaleString()}</td>
							</tr>
							<tr>
								<td>relation changes</td>
								<td>{relationChanges.toLocaleString()}</td>
							</tr>
							<tr>
								<td>total changes</td>
								<td>{totalChanges.toLocaleString()}</td>
							</tr>
							<tr>
								<td>deduplicated nodes</td>
								<td>{changes.stats.deduplicatedNodes.toLocaleString()}</td>
							</tr>
							<tr>
								<td>deduplicated nodes replaced</td>
								<td>
									{changes.stats.deduplicatedNodesReplaced.toLocaleString()}
								</td>
							</tr>
							<tr>
								<td>intersection points found</td>
								<td>
									{changes.stats.intersectionPointsFound.toLocaleString()}
								</td>
							</tr>
						</tbody>
					</table>

					{children}
				</DetailsContent>
			</Details>
		</div>
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
}: { setSelectedEntity: (entity: OsmEntity) => void }) {
	const currentChanges = useAtomValue(currentChangesAtom)
	const startIndex = useAtomValue(startIndexAtom)

	return (
		<div className="flex flex-col gap-1">
			{currentChanges.map(({ changeType, entity, note }, i) => {
				const changeTypeColor = CHANGE_TYPE_COLOR[changeType]
				const entityType = getEntityType(entity)
				return (
					<button
						key={`${entityType}-${entity.id}`}
						className={cn(
							"border-l pl-2 font-bold cursor-pointer w-full text-left",
							changeTypeColor,
						)}
						onClick={() => setSelectedEntity(entity)}
						type="button"
						tabIndex={0}
					>
						{startIndex + i + 1}. {changeType.toUpperCase()}{" "}
						{entityType.toUpperCase()} {entity.id} {note && `(${note})`}
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
			{currentChanges.map(({ changeType, entity, note }, i) => {
				const changeTypeColor = CHANGE_TYPE_COLOR[changeType]
				const entityType = getEntityType(entity)
				return (
					<Details key={`${entityType}-${entity.id}`} open={false}>
						<DetailsSummary className={cn(changeTypeColor)}>
							{startIndex + i + 1}. {changeType.toUpperCase()}{" "}
							{entityType.toUpperCase()} {entity.id}
						</DetailsSummary>
						<DetailsContent>
							{note && <div className="p-1 border-1">{note}</div>}
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
	if (totalPages <= 1) return null
	return (
		<div className="flex items-center justify-between">
			<Button
				variant="ghost"
				size="sm"
				onClick={goToPrevPage}
				disabled={currentPage === 0}
			>
				<ArrowLeft className="w-3 h-3 mr-1" />
			</Button>
			<span className="text-xs text-slate-500">
				{(currentPage + 1).toLocaleString()} of {totalPages.toLocaleString()}
			</span>
			<Button
				variant="ghost"
				size="sm"
				onClick={goToNextPage}
				disabled={currentPage === totalPages - 1}
			>
				<ArrowRight className="w-3 h-3 ml-1" />
			</Button>
		</div>
	)
}
