import { useAtomValue } from "jotai"
import {
	DownloadIcon,
	EyeIcon,
	EyeOffIcon,
	MaximizeIcon,
	SaveIcon,
	XIcon,
} from "lucide-react"
import { useCallback, useEffect, useState } from "react"
import { useFlyToOsmBounds, useMap } from "../hooks/map"
import type { UseOsmFileReturn } from "../hooks/osm"
import { APPID } from "../settings"
import { osmFileControlIsOpenAtom } from "../state/map"
import ActionButton from "./action-button"
import OsmInfoTable from "./osm-info-table"
import { Button } from "./ui/button"

interface OsmFileCardProps {
	osmFile: UseOsmFileReturn
	onClear?: () => Promise<void>
}

function OsmFileCard({ osmFile, onClear }: OsmFileCardProps) {
	const map = useMap()
	const flyToOsmBounds = useFlyToOsmBounds()
	const [layersVisible, setLayersVisible] = useState(true)

	const osmId = osmFile.osm?.id

	// Get all layer IDs for this OSM file
	const getOsmLayerIds = useCallback(() => {
		if (!map || !osmId) return []
		const style = map.getStyle()
		if (!style?.layers) return []
		const prefix = `${APPID}:${osmId}`
		return style.layers
			.filter((layer) => layer.id.startsWith(prefix))
			.map((layer) => layer.id)
	}, [map, osmId])

	// Check visibility state when map style changes
	useEffect(() => {
		if (!map || !osmId) return

		const checkVisibility = () => {
			const layerIds = getOsmLayerIds()
			if (layerIds.length === 0) return
			// Check if any layer is visible
			const anyVisible = layerIds.some((id) => {
				const visibility = map.getLayoutProperty(id, "visibility")
				return visibility !== "none"
			})
			setLayersVisible(anyVisible)
		}

		checkVisibility()
		map.on("styledata", checkVisibility)
		return () => {
			map.off("styledata", checkVisibility)
		}
	}, [map, osmId, getOsmLayerIds])

	const toggleLayersVisibility = () => {
		if (!map || !osmId) return
		const layerIds = getOsmLayerIds()
		const newVisibility = layersVisible ? "none" : "visible"
		for (const id of layerIds) {
			map.getMap().setLayoutProperty(id, "visibility", newVisibility)
		}
		setLayersVisible(!layersVisible)
	}

	if (!osmFile.osm || !osmFile.osmInfo || !osmFile.fileInfo) {
		return null
	}

	const fileName = osmFile.fileInfo.fileName

	return (
		<div className="border-b last:border-b-0">
			<div className="flex items-center justify-between gap-2 border-b">
				<div className="font-bold pl-2">{fileName}</div>
				<div className="flex items-center">
					<Button
						onClick={toggleLayersVisibility}
						variant="ghost"
						size="icon-sm"
						title={layersVisible ? "Hide map layers" : "Show map layers"}
					>
						{layersVisible ? <EyeIcon /> : <EyeOffIcon />}
					</Button>
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
				</div>
			</div>
			<OsmInfoTable
				defaultOpen={false}
				osm={osmFile.osm}
				file={osmFile.file}
				fileInfo={osmFile.fileInfo}
			/>
		</div>
	)
}

export interface OsmFileMapControlProps {
	files: Array<{
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
					key={file.osmFile.fileInfo?.fileHash}
					osmFile={file.osmFile}
					onClear={file.onClear}
				/>
			))}
		</div>
	)
}
