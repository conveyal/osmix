/**
 * UI component for managing stored Osm data in IndexedDB.
 * Uses BroadcastChannel to receive updates from the worker.
 */

import type { OsmInfo } from "@osmix/core"
import {
	CheckIcon,
	DatabaseIcon,
	FilesIcon,
	PencilIcon,
	RotateCcwIcon,
	Trash2Icon,
	XIcon,
} from "lucide-react"
import type { OsmFileType } from "osmix"
import { useEffectEvent, useRef, useState } from "react"
import { type StoredOsmEntry, useStoredOsm } from "../hooks/storage-broadcast"
import { osmWorker } from "../state/worker"
import ActionButton from "./action-button"
import { Details, DetailsContent, DetailsSummary } from "./details"
import {
	OsmPbfOpenUrlButton,
	OsmPbfSelectFileButton,
} from "./osm-pbf-file-input"
import { Button } from "./ui/button"
import { Card, CardContent, CardHeader } from "./ui/card"
import { Input } from "./ui/input"
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
	const [isRenaming, setIsRenaming] = useState(false)
	const [renameValue, setRenameValue] = useState(entry.fileName)
	const inputRef = useRef<HTMLInputElement>(null)

	const handleDelete = useEffectEvent(async () => {
		setIsDeleting(true)
		try {
			await osmWorker.deleteStoredOsm(entry.fileHash)
		} finally {
			setIsDeleting(false)
		}
	})

	const handleStartRename = useEffectEvent(() => {
		setRenameValue(entry.fileName)
		setIsRenaming(true)
		// Focus input after render
		setTimeout(() => inputRef.current?.select(), 0)
	})

	const handleConfirmRename = useEffectEvent(async () => {
		const trimmed = renameValue.trim()
		if (trimmed && trimmed !== entry.fileName) {
			await osmWorker.renameStoredOsm(entry.fileHash, trimmed)
		}
		setIsRenaming(false)
	})

	const handleCancelRename = useEffectEvent(() => {
		setRenameValue(entry.fileName)
		setIsRenaming(false)
	})

	const handleKeyDown = useEffectEvent((e: React.KeyboardEvent) => {
		if (e.key === "Enter") {
			e.preventDefault()
			handleConfirmRename()
		} else if (e.key === "Escape") {
			e.preventDefault()
			handleCancelRename()
		}
	})

	return (
		<Item className={isActive ? "bg-blue-50 border-blue-200" : ""}>
			<ItemHeader>
				{isRenaming ? (
					<Input
						ref={inputRef}
						value={renameValue}
						onChange={(e) => setRenameValue(e.target.value)}
						onKeyDown={handleKeyDown}
						onBlur={handleConfirmRename}
						className="h-7 text-sm font-bold"
					/>
				) : (
					<ItemTitle className="truncate">{entry.fileName}</ItemTitle>
				)}

				<ItemActions>
					{isRenaming ? (
						<>
							<Button
								variant="outline"
								size="icon-sm"
								title="Confirm rename"
								onClick={handleConfirmRename}
							>
								<CheckIcon />
							</Button>
							<Button
								variant="outline"
								size="icon-sm"
								title="Cancel rename"
								onClick={handleCancelRename}
							>
								<XIcon />
							</Button>
						</>
					) : (
						<>
							<Button
								variant="outline"
								size="icon-sm"
								title="Rename file"
								onClick={handleStartRename}
							>
								<PencilIcon />
							</Button>
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
						</>
					)}
				</ItemActions>
			</ItemHeader>
			<ItemContent className="text-muted-foreground">
				{formatStats(entry.info)} &middot; {formatDate(entry.lastAccessedAt)}
			</ItemContent>
		</Item>
	)
}

interface StoredOsmListProps {
	activeOsmId?: string
	openOsmFile: (
		file: File | string,
		fileType?: OsmFileType,
	) => Promise<OsmInfo | null>
}

export function StoredOsmList({
	activeOsmId,
	openOsmFile,
}: StoredOsmListProps) {
	const { entries, estimatedBytes } = useStoredOsm(osmWorker)

	return (
		<Card>
			<CardHeader>
				<div className="font-bold uppercase p-2 flex items-center gap-1">
					<FilesIcon className="size-3" />
					FILES
				</div>
			</CardHeader>
			<CardContent className="p-0">
				<div className="flex flex-col gap-2 p-2">
					<OsmPbfSelectFileButton
						setFile={async (file, fileType) => {
							if (file == null) return
							await openOsmFile(file, fileType)
						}}
					/>
					<OsmPbfOpenUrlButton
						setFile={async (file, fileType) => {
							if (file == null) return
							await openOsmFile(file, fileType)
						}}
					/>
				</div>
				{entries.length > 0 && (
					<Details>
						<DetailsSummary>
							<div className="flex items-center gap-2">
								<DatabaseIcon className="size-3" /> <div>Stored</div>
								<span className="text-muted-foreground">
									&middot; {entries.length} &middot;{" "}
									{formatBytes(estimatedBytes)}
								</span>
							</div>
						</DetailsSummary>
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
