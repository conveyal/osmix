import { useAtomValue } from "jotai"
import {
	ChevronDown,
	Eye,
	EyeOff,
	Folder,
	FolderOpen,
	Layers,
} from "lucide-react"
import { useCallback, useEffect, useMemo, useState } from "react"
import { useMap } from "../hooks/map"
import { cn } from "../lib/utils"
import { APPID } from "../settings"
import { layerControlIsOpenAtom } from "../state/map"
import CustomControl from "./custom-control"
import { Button } from "./ui/button"
import {
	Collapsible,
	CollapsibleContent,
	CollapsibleTrigger,
} from "./ui/collapsible"
import { Input } from "./ui/input"

type LayerInfo = {
	id: string
	type: string
	visible: boolean
}

type LayerGroup = {
	id: string
	name: string
	layers: LayerInfo[]
}

export default function MapLayerControl() {
	const isOpen = useAtomValue(layerControlIsOpenAtom)
	if (!isOpen) return null
	return (
		<CustomControl position="bottom-right" className="w-72">
			<MapLayers />
		</CustomControl>
	)
}

export function MapLayers() {
	const map = useMap()
	const [layers, setLayers] = useState<LayerInfo[]>([])
	const [searchQuery, setSearchQuery] = useState("")
	const [isOpen, setIsOpen] = useState(true)

	// Fetch layers from the map
	const refreshLayers = useCallback(() => {
		const layerInfos: LayerInfo[] = (map?.getStyle()?.layers ?? []).map(
			(layer) => {
				const visibility = map?.getLayoutProperty(layer.id, "visibility")
				return {
					id: layer.id,
					type: layer.type,
					visible: visibility !== "none",
				}
			},
		)

		setLayers(layerInfos)
	}, [map])

	// Listen for style changes
	useEffect(() => {
		if (!map) return

		refreshLayers()

		map.on("styledata", refreshLayers)
		map.on("load", refreshLayers)

		return () => {
			map.off("styledata", refreshLayers)
			map.off("load", refreshLayers)
		}
	}, [map, refreshLayers])

	// Group layers by prefix
	const groups = useMemo((): LayerGroup[] => {
		const osmixLayers: LayerInfo[] = []
		const basemapLayers: LayerInfo[] = []

		for (const layer of layers) {
			if (layer.id.startsWith(APPID)) {
				osmixLayers.push(layer)
			} else {
				basemapLayers.push(layer)
			}
		}

		return [
			{ id: "osmix", name: "Osmix", layers: osmixLayers },
			{ id: "basemap", name: "Basemap", layers: basemapLayers },
		]
	}, [layers])

	// Filter layers by search query
	const filteredGroups = useMemo((): LayerGroup[] => {
		if (!searchQuery.trim()) return groups
		const query = searchQuery.toLowerCase()
		return groups.map((group) => ({
			...group,
			layers: group.layers.filter((layer) =>
				layer.id.toLowerCase().includes(query),
			),
		}))
	}, [groups, searchQuery])

	// Toggle layer visibility
	const toggleLayerVisibility = useCallback(
		(layerId: string, currentlyVisible: boolean) => {
			const newVisibility = currentlyVisible ? "none" : "visible"
			map?.getMap().setLayoutProperty(layerId, "visibility", newVisibility)
			refreshLayers()
		},
		[map, refreshLayers],
	)

	// Toggle all layers in a group
	const toggleGroupVisibility = useCallback(
		(group: LayerGroup, show: boolean) => {
			const visibility = show ? "visible" : "none"
			for (const layer of group.layers) {
				map?.getMap().setLayoutProperty(layer.id, "visibility", visibility)
			}
			refreshLayers()
		},
		[map, refreshLayers],
	)

	if (!map) return null

	return (
		<Collapsible open={isOpen} onOpenChange={setIsOpen}>
			<CollapsibleTrigger className="flex h-8 cursor-pointer w-full items-center justify-between p-2">
				<div className="flex items-center gap-2">
					<Layers className="size-4" />
					<span className="font-bold uppercase">Layers</span>
				</div>
				<div className="flex items-center gap-2">
					<span className="text-muted-foreground">{layers.length}</span>

					<ChevronDown
						className={cn(
							"size-4 transition-transform",
							isOpen && "rotate-180",
						)}
					/>
				</div>
			</CollapsibleTrigger>

			<CollapsibleContent>
				<Input
					type="text"
					placeholder="Search layers..."
					value={searchQuery}
					onChange={(e) => setSearchQuery(e.target.value)}
					className="h-8 bg-slate-50 rounded-none shadow-inner"
				/>

				<div>
					{filteredGroups.length === 0 ? (
						<div className="text-muted-foreground text-center py-2">
							No layers found
						</div>
					) : (
						filteredGroups.map((group) => (
							<LayerGroupComponent
								key={group.id}
								group={group}
								onToggleLayer={toggleLayerVisibility}
								onToggleGroup={toggleGroupVisibility}
							/>
						))
					)}
				</div>
			</CollapsibleContent>
		</Collapsible>
	)
}

function LayerGroupComponent({
	group,
	onToggleLayer,
	onToggleGroup,
}: {
	group: LayerGroup
	onToggleLayer: (layerId: string, currentlyVisible: boolean) => void
	onToggleGroup: (group: LayerGroup, show: boolean) => void
}) {
	const visibleCount = group.layers.filter((l) => l.visible).length
	const allVisible = visibleCount === group.layers.length
	const noneVisible = visibleCount === 0

	return (
		<Collapsible>
			<CollapsibleTrigger className="group cursor-pointer flex h-8 p-2 justify-between items-center w-full">
				<div className="uppercase flex gap-2 items-center">
					<FolderOpen className="size-4 hidden group-data-[state=open]:block" />
					<Folder className="size-4 block group-data-[state=open]:hidden" />{" "}
					{group.name}
				</div>
				<div className="flex gap-0 items-center">
					<span className="text-muted-foreground pr-1">
						{visibleCount}/{group.layers.length}
					</span>
					<Button
						onClick={(e) => {
							e.preventDefault()
							onToggleGroup(group, noneVisible || !allVisible)
						}}
						variant="ghost"
						size="icon-sm"
						title={allVisible ? "Hide all layers" : "Show all layers"}
					>
						{allVisible ? (
							<Eye />
						) : noneVisible ? (
							<EyeOff className="text-muted-foreground" />
						) : (
							<Eye className="text-muted-foreground" />
						)}
					</Button>

					<ChevronDown
						className={
							"size-4 transition-transform group-data-[state=open]:rotate-180"
						}
					/>
				</div>
			</CollapsibleTrigger>
			<CollapsibleContent className="border-t shadow-inner">
				<div className="flex flex-col gap-y-0">
					{group.layers.map((layer) => (
						<Button
							className="flex gap-2 w-full items-center"
							key={layer.id}
							onClick={() => onToggleLayer(layer.id, layer.visible)}
							title={layer.visible ? "Hide layer" : "Show layer"}
							variant="ghost"
							size="xs"
						>
							{layer.visible ? (
								<Eye className="size-3.5" />
							) : (
								<EyeOff className="size-3.5 text-muted-foreground" />
							)}

							<div className="truncate text-left flex-1">{layer.id}</div>
							<div className="text-muted-foreground shrink-0">{layer.type}</div>
						</Button>
					))}
				</div>
			</CollapsibleContent>
		</Collapsible>
	)
}
