import type { OsmChange, OsmChanges } from "@osmix/core"
import { atom } from "jotai"

export const DEFAULT_PAGE_SIZE = 10

/**
 * OSM Change Summary State, can use a Provider or set changesAtom directly.
 */
export const changesAtom = atom<OsmChanges | null>(null)
export const pageSizeAtom = atom<number>(DEFAULT_PAGE_SIZE)
export const pageAtom = atom<number>(0)
export const changeTypeFilterAtom = atom<{
	create: boolean
	modify: boolean
	delete: boolean
}>({ create: true, modify: true, delete: true })
export const entityTypeFilterAtom = atom<{
	node: boolean
	way: boolean
	relation: boolean
}>({ node: true, way: true, relation: true })

export const filteredChangesAtom = atom<OsmChange[]>((get) => {
	const changes = get(changesAtom)
	if (!changes) return []
	const changeTypeFilter = get(changeTypeFilterAtom)
	const entityTypeFilter = get(entityTypeFilterAtom)
	const filteredChanges: OsmChange[] = []
	if (entityTypeFilter.node) {
		for (const change of Object.values(changes.nodes)) {
			if (changeTypeFilter[change.changeType]) {
				filteredChanges.push(change)
			}
		}
	}
	if (entityTypeFilter.way) {
		for (const change of Object.values(changes.ways)) {
			if (changeTypeFilter[change.changeType]) {
				filteredChanges.push(change)
			}
		}
	}
	if (entityTypeFilter.relation) {
		for (const change of Object.values(changes.relations)) {
			if (changeTypeFilter[change.changeType]) {
				filteredChanges.push(change)
			}
		}
	}
	return filteredChanges
})

export const changesSummaryAtom = atom((get) => {
	const changes = get(changesAtom)
	if (!changes) return null
	const nodeChanges = Object.keys(changes.nodes).length
	const wayChanges = Object.keys(changes.ways).length
	const relationChanges = Object.keys(changes.relations).length
	return {
		totalChanges: nodeChanges + wayChanges + relationChanges,
		nodeChanges,
		wayChanges,
		relationChanges,
	}
})

export const totalPagesAtom = atom<number>((get) => {
	const pageSize = get(pageSizeAtom)
	const filteredChanges = get(filteredChangesAtom)
	return Math.ceil(filteredChanges.length / pageSize)
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

export const currentChangesAtom = atom<OsmChange[]>((get) => {
	const filteredChanges = get(filteredChangesAtom)
	const startIndex = get(startIndexAtom)
	const endIndex = get(endIndexAtom)
	return filteredChanges.slice(startIndex, endIndex)
})
