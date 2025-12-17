/**
 * UI component for managing stored Osm data in IndexedDB.
 */

import type { OsmInfo } from "@osmix/core"
import { DatabaseIcon, RotateCcwIcon, Trash2Icon } from "lucide-react"
import { useCallback, useState, useSyncExternalStore } from "react"
import { osmStorage, type StoredOsmEntry } from "../lib/osm-storage"
import ActionButton from "./action-button"
import { Details, DetailsContent, DetailsSummary } from "./details"
import { OsmPbfSelectFileButton } from "./osm-pbf-file-input"
import { Card, CardContent, CardHeader } from "./ui/card"
import {
	Item,
	ItemActions,
	ItemContent,
	ItemGroup,
	ItemHeader,
	ItemTitle,
} from "./ui/item"

function formatBytes(bytes: number): string {
	if (bytes === 0) return "0 B"
	const kb = bytes / 1024
	if (kb < 1000) return `${Math.ceil(kb)} KB`
	const mb = kb / 1024
	if (mb < 1000) return `${Math.ceil(mb)} MB`
	return `${(mb / 1024).toFixed(2)} GB`
}

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
	isActive?: boolean
}

function StoredOsmItem({ entry, onLoad, isActive }: StoredOsmItemProps) {
	const [isDeleting, setIsDeleting] = useState(false)

	const handleDelete = useCallback(async () => {
		setIsDeleting(true)
		try {
			await osmStorage.deleteStoredOsm(entry.fileHash)
		} finally {
			setIsDeleting(false)
		}
	}, [entry.fileHash])

	return (
		<Item className={isActive ? "bg-blue-50 border-blue-200" : ""}>
			<ItemContent>
				<ItemHeader>
					<ItemTitle className="truncate">{entry.fileName}</ItemTitle>

					<ItemActions>
						<ActionButton
							variant="outline"
							title="Restore from storage"
							icon={<RotateCcwIcon />}
							onAction={() => onLoad(entry.fileHash)}
						/>
						<ActionButton
							variant="outline"
							title="Delete from storage"
							icon={<Trash2Icon />}
							disabled={isDeleting}
							onAction={handleDelete}
						/>
					</ItemActions>
				</ItemHeader>
				<span className="text-muted-foreground truncate">
					{formatStats(entry.info)} &middot; {formatDate(entry.storedAt)}
				</span>
			</ItemContent>
		</Item>
	)
}

interface StoredOsmListProps {
	activeOsmId?: string
	openOsmFile: (file: File | string) => Promise<OsmInfo | null>
}

export function StoredOsmList({
	activeOsmId,
	openOsmFile,
}: StoredOsmListProps) {
	const { entries, estimatedBytes } = useSyncExternalStore(
		osmStorage.subscribe,
		osmStorage.getSnapshot,
	)

	return (
		<Card>
			<CardHeader>
				<div className="font-bold uppercase p-2 flex items-center gap-2">
					<DatabaseIcon className="size-3" />
					FILES
				</div>
				{entries.length > 0 && (
					<span className="text-muted-foreground pr-2">
						{entries.length} &middot; {formatBytes(estimatedBytes)}
					</span>
				)}
			</CardHeader>
			<CardContent className="p-0">
				<OsmPbfSelectFileButton
					setFile={async (file) => {
						if (file == null) return
						await openOsmFile(file)
					}}
				/>
				{entries.length > 0 && (
					<Details defaultOpen>
						<DetailsSummary>Stored</DetailsSummary>
						<DetailsContent>
							<ItemGroup>
								{entries.map((entry) => (
									<StoredOsmItem
										key={entry.fileHash}
										entry={entry}
										onLoad={openOsmFile}
										isActive={entry.fileHash === activeOsmId}
									/>
								))}
							</ItemGroup>
						</DetailsContent>
					</Details>
				)}
			</CardContent>
		</Card>
	)
}

export default StoredOsmList
