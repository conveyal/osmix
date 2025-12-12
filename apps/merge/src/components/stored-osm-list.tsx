/**
 * UI component for managing stored Osm data in IndexedDB.
 */

import type { OsmInfo } from "@osmix/core"
import { useAtom } from "jotai"
import { DatabaseIcon, DownloadIcon, Trash2Icon } from "lucide-react"
import { useCallback, useEffect, useState } from "react"
import { deleteStoredOsm, type StoredOsmEntry } from "../lib/osm-storage"
import { storedOsmEntriesAtom } from "../state/storage"
import ActionButton from "./action-button"
import { Details, DetailsContent, DetailsSummary } from "./details"
import { Card, CardContent, CardHeader } from "./ui/card"
import {
	Item,
	ItemActions,
	ItemContent,
	ItemHeader,
	ItemTitle,
} from "./ui/item"

function formatDate(timestamp: number): string {
	return new Date(timestamp).toLocaleDateString(undefined, {
		month: "short",
		day: "numeric",
		hour: "2-digit",
		minute: "2-digit",
	})
}

function formatStats(info: OsmInfo): string {
	const parts: string[] = []
	if (info.stats.nodes > 0) parts.push(`${info.stats.nodes.toLocaleString()}n`)
	if (info.stats.ways > 0) parts.push(`${info.stats.ways.toLocaleString()}w`)
	if (info.stats.relations > 0)
		parts.push(`${info.stats.relations.toLocaleString()}r`)
	return parts.join(" / ")
}

interface StoredOsmItemProps {
	entry: StoredOsmEntry
	onLoad: (id: string) => Promise<OsmInfo | null>
	onDelete: (id: string) => Promise<void>
	isActive?: boolean
}

function StoredOsmItem({
	entry,
	onLoad,
	onDelete,
	isActive,
}: StoredOsmItemProps) {
	const [isDeleting, setIsDeleting] = useState(false)

	const handleLoad = useCallback(async () => {
		await onLoad(entry.id)
	}, [entry.id, onLoad])

	const handleDelete = useCallback(async () => {
		setIsDeleting(true)
		try {
			await onDelete(entry.id)
		} finally {
			setIsDeleting(false)
		}
	}, [entry.id, onDelete])

	return (
		<Item size="sm" className={isActive ? "bg-blue-50 border-blue-200" : ""}>
			<ItemContent>
				<ItemHeader>
					<ItemTitle className="text-sm truncate">{entry.id}</ItemTitle>
					<ItemActions>
						<ActionButton
							size="icon-sm"
							variant="ghost"
							title="Load from storage"
							icon={<DownloadIcon />}
							onAction={handleLoad}
						/>
						<ActionButton
							size="icon-sm"
							variant="ghost"
							title="Delete from storage"
							icon={<Trash2Icon />}
							disabled={isDeleting}
							onAction={handleDelete}
						/>
					</ItemActions>
				</ItemHeader>
				<span className="text-xs text-slate-500 truncate">
					{formatStats(entry.info)} &middot; {formatDate(entry.storedAt)}
				</span>
			</ItemContent>
		</Item>
	)
}

interface StoredOsmListProps {
	onLoad: (id: string) => Promise<OsmInfo | null>
	activeOsmId?: string
}

export function StoredOsmList({ onLoad, activeOsmId }: StoredOsmListProps) {
	const [entries, refreshEntries] = useAtom(storedOsmEntriesAtom)
	const [isInitialized, setIsInitialized] = useState(false)

	// Load entries on mount
	useEffect(() => {
		refreshEntries().then(() => setIsInitialized(true))
	}, [refreshEntries])

	const handleDelete = useCallback(
		async (id: string) => {
			await deleteStoredOsm(id)
			await refreshEntries()
		},
		[refreshEntries],
	)

	if (!isInitialized || entries.length === 0) {
		return null
	}

	return (
		<Card>
			<CardHeader>
				<div className="font-bold uppercase p-2 flex items-center gap-2">
					<DatabaseIcon className="size-4" />
					STORED DATA
				</div>
			</CardHeader>
			<CardContent className="p-0">
				<Details defaultOpen>
					<DetailsSummary>{entries.length} stored file(s)</DetailsSummary>
					<DetailsContent className="p-2 space-y-1">
						{entries.map((entry) => (
							<StoredOsmItem
								key={entry.id}
								entry={entry}
								onLoad={onLoad}
								onDelete={handleDelete}
								isActive={entry.id === activeOsmId}
							/>
						))}
					</DetailsContent>
				</Details>
			</CardContent>
		</Card>
	)
}

export default StoredOsmList
