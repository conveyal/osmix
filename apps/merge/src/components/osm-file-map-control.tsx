import { useAtomValue } from "jotai"
import { DownloadIcon, MaximizeIcon, SaveIcon, XIcon } from "lucide-react"
import type { UseOsmFileReturn } from "../hooks/osm"
import { useFlyToOsmBounds } from "../hooks/map"
import { osmFileControlIsOpenAtom } from "../state/map"
import ActionButton from "./action-button"
import OsmInfoTable from "./osm-info-table"
import { ButtonGroup } from "./ui/button-group"

interface OsmFileCardProps {
	label: string
	osmFile: UseOsmFileReturn
	onClear?: () => Promise<void>
}

function OsmFileCard({ label, osmFile, onClear }: OsmFileCardProps) {
	const flyToOsmBounds = useFlyToOsmBounds()

	if (!osmFile.osm || !osmFile.osmInfo || !osmFile.fileInfo) {
		return null
	}

	return (
		<div className="border-b last:border-b-0">
			<div className="flex items-center justify-between border-b bg-slate-50 px-2 py-1">
				<div className="font-bold text-xs uppercase">{label}</div>
				<ButtonGroup>
					{!osmFile.isStored && (
						<ActionButton
							onAction={osmFile.saveToStorage}
							variant="ghost"
							icon={<SaveIcon />}
							title="Save to storage"
						/>
					)}
					<ActionButton
						onAction={osmFile.downloadOsm}
						variant="ghost"
						icon={<DownloadIcon />}
						title="Download OSM PBF"
					/>
					<ActionButton
						onAction={async () => flyToOsmBounds(osmFile.osmInfo)}
						variant="ghost"
						icon={<MaximizeIcon />}
						title="Fit bounds to file bbox"
					/>
					{onClear && (
						<ActionButton
							onAction={onClear}
							icon={<XIcon />}
							title="Clear file"
							variant="ghost"
						/>
					)}
				</ButtonGroup>
			</div>
			<div className="p-2">
				<OsmInfoTable
					defaultOpen={false}
					osm={osmFile.osm}
					file={osmFile.file}
					fileInfo={osmFile.fileInfo}
				/>
			</div>
		</div>
	)
}

export interface OsmFileMapControlProps {
	files: Array<{
		label: string
		osmFile: UseOsmFileReturn
		onClear?: () => Promise<void>
	}>
}

export default function OsmFileMapControl({ files }: OsmFileMapControlProps) {
	const isOpen = useAtomValue(osmFileControlIsOpenAtom)

	if (!isOpen) return null

	// Filter to only show files that are loaded
	const loadedFiles = files.filter(
		(f) => f.osmFile.osm && f.osmFile.osmInfo && f.osmFile.fileInfo,
	)

	if (loadedFiles.length === 0) return null

	return (
		<div className="flex flex-col">
			{loadedFiles.map((file) => (
				<OsmFileCard
					key={file.label}
					label={file.label}
					osmFile={file.osmFile}
					onClear={file.onClear}
				/>
			))}
		</div>
	)
}
