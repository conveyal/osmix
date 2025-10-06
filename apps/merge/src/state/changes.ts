import type { OsmChangesetStats, OsmChangeTypes } from "@osmix/core"
import type { OsmEntityType } from "@osmix/json"
import { atom } from "jotai"
import { osmWorker } from "./worker"

export const DEFAULT_PAGE_SIZE = 10

/**
 * OSM Change Summary State, can use a Provider or set changesAtom directly.
 */
export const changesetStatsAtom = atom<OsmChangesetStats | null>(null)
export const pageSizeAtom = atom<number>(DEFAULT_PAGE_SIZE)
export const pageAtom = atom<number>(0)
export const changeTypeFilterAtom = atom<OsmChangeTypes[]>([
	"create",
	"modify",
	"delete",
])
export const entityTypeFilterAtom = atom<OsmEntityType[]>([
	"node",
	"way",
	"relation",
])

export const changesAtom = atom(async (get) => {
	const changeStats = get(changesetStatsAtom)
	if (!changeStats) return null
	const pageSize = get(pageSizeAtom)
	const page = get(pageAtom)
	const changeTypeFilter = get(changeTypeFilterAtom)
	const entityTypeFilter = get(entityTypeFilterAtom)
	const filteredChanges = await osmWorker.getFilteredChangeset(
		changeStats.osmId,
		page,
		pageSize,
		changeTypeFilter,
		entityTypeFilter,
	)
	return filteredChanges
})

export const startIndexAtom = atom<number>((get) => {
	const pageSize = get(pageSizeAtom)
	const currentPage = get(pageAtom)
	return currentPage * pageSize
})

export const endIndexAtom = atom<number>((get) => {
	const pageSize = get(pageSizeAtom)
	const startIndex = get(startIndexAtom)
	return startIndex + pageSize
})
