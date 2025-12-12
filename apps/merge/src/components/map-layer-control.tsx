import { useAtomValue } from "jotai"
import {
	ChevronDown,
	Eye,
	EyeOff,
	Folder,
	FolderOpen,
	Layers,
	MoreVertical,
} from "lucide-react"
import { Fragment, useCallback, useEffect, useMemo, useState } from "react"
import { useMap } from "../hooks/map"
import { cn } from "../lib/utils"
import { APPID } from "../settings"
import { layerControlIsOpenAtom } from "../state/map"
import CustomControl from "./custom-control"
import {
	Collapsible,
	CollapsibleContent,
	CollapsibleTrigger,
} from "./ui/collapsible"
import {
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuItem,
	DropdownMenuSeparator,
	DropdownMenuTrigger,
} from "./ui/dropdown-menu"
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

const LAYER_TYPES = ["line", "symbol", "fill", "circle", "raster"] as const
type LayerType = (typeof LAYER_TYPES)[number]

const LAYER_TYPE_LABELS: Record<LayerType, string> = {
	line: "Line",
	symbol: "Symbol",
	fill: "Fill",
	circle: "Circle",
	raster: "Raster",
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
	const [expandedGroups, setExpandedGroups] = useState<Set<string>>(
		new Set(["osmix"]),
	)

	// Fetch layers from the map
	const refreshLayers = useCallback(() => {
		if (!map) return
		const style = map.getStyle()
		if (!style?.layers) return

		const layerInfos: LayerInfo[] = style.layers.map((layer) => {
			const visibility = map.getLayoutProperty(layer.id, "visibility")
			return {
				id: layer.id,
				type: layer.type,
				visible: visibility !== "none",
			}
		})

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
		return groups
			.map((group) => ({
				...group,
				layers: group.layers.filter((layer) =>
					layer.id.toLowerCase().includes(query),
				),
			}))
			.filter((group) => group.layers.length > 0)
	}, [groups, searchQuery])

	const totalFilteredLayers = useMemo(
		() => filteredGroups.reduce((sum, g) => sum + g.layers.length, 0),
		[filteredGroups],
	)

	// Toggle layer visibility
	const toggleLayerVisibility = useCallback(
		(layerId: string, currentlyVisible: boolean) => {
			if (!map) return
			const newVisibility = currentlyVisible ? "none" : "visible"
			map.getMap().setLayoutProperty(layerId, "visibility", newVisibility)
			refreshLayers()
		},
		[map, refreshLayers],
	)

	// Toggle all layers in a group
	const toggleGroupVisibility = useCallback(
		(group: LayerGroup, show: boolean) => {
			if (!map) return
			const visibility = show ? "visible" : "none"
			for (const layer of group.layers) {
				map.getMap().setLayoutProperty(layer.id, "visibility", visibility)
			}
			refreshLayers()
		},
		[map, refreshLayers],
	)

	// Toggle layers of a specific type in a group
	const toggleTypeVisibility = useCallback(
		(group: LayerGroup, type: LayerType, show: boolean) => {
			if (!map) return
			const visibility = show ? "visible" : "none"
			for (const layer of group.layers) {
				if (layer.type === type) {
					map.getMap().setLayoutProperty(layer.id, "visibility", visibility)
				}
			}
			refreshLayers()
		},
		[map, refreshLayers],
	)

	// Toggle group expansion
	const toggleGroupExpanded = useCallback((groupId: string) => {
		setExpandedGroups((prev) => {
			const next = new Set(prev)
			if (next.has(groupId)) {
				next.delete(groupId)
			} else {
				next.add(groupId)
			}
			return next
		})
	}, [])

	if (!map) return null

	return (
		<Collapsible open={isOpen} onOpenChange={setIsOpen}>
			<CollapsibleTrigger asChild>
				<button
					type="button"
					className="w-full cursor-pointer flex items-center gap-2 p-2 hover:bg-accent transition-colors"
				>
					<Layers className="size-4" />
					<span className="flex-1 text-left font-bold uppercase">Layers</span>
					<span className="text-muted-foreground">{totalFilteredLayers}</span>
					<ChevronDown
						className={cn(
							"size-4 transition-transform",
							isOpen && "rotate-180",
						)}
					/>
				</button>
			</CollapsibleTrigger>

			<CollapsibleContent className="px-2">
				<Input
					type="text"
					placeholder="Search layers..."
					value={searchQuery}
					onChange={(e) => setSearchQuery(e.target.value)}
					className="h-8"
				/>

				<div className="max-h-80 overflow-y-auto space-y-1 mt-2 mb-2">
					{filteredGroups.length === 0 ? (
						<div className="text-muted-foreground text-center py-2">
							No layers found
						</div>
					) : (
						filteredGroups.map((group) => (
							<LayerGroupComponent
								key={group.id}
								group={group}
								expanded={expandedGroups.has(group.id)}
								onToggleExpanded={() => toggleGroupExpanded(group.id)}
								onToggleLayer={toggleLayerVisibility}
								onToggleGroup={toggleGroupVisibility}
								onToggleType={toggleTypeVisibility}
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
	expanded,
	onToggleExpanded,
	onToggleLayer,
	onToggleGroup,
	onToggleType,
}: {
	group: LayerGroup
	expanded: boolean
	onToggleExpanded: () => void
	onToggleLayer: (layerId: string, currentlyVisible: boolean) => void
	onToggleGroup: (group: LayerGroup, show: boolean) => void
	onToggleType: (group: LayerGroup, type: LayerType, show: boolean) => void
}) {
	const visibleCount = group.layers.filter((l) => l.visible).length
	const allVisible = visibleCount === group.layers.length
	const noneVisible = visibleCount === 0

	// Get available layer types in this group
	const availableTypes = useMemo(() => {
		const types = new Set<LayerType>()
		for (const layer of group.layers) {
			if (LAYER_TYPES.includes(layer.type as LayerType)) {
				types.add(layer.type as LayerType)
			}
		}
		return Array.from(types).sort()
	}, [group.layers])

	// Count visible layers by type
	const typeVisibility = useMemo(() => {
		const counts: Record<string, { visible: number; total: number }> = {}
		for (const type of availableTypes) {
			const layersOfType = group.layers.filter((l) => l.type === type)
			counts[type] = {
				visible: layersOfType.filter((l) => l.visible).length,
				total: layersOfType.length,
			}
		}
		return counts
	}, [group.layers, availableTypes])

	if (group.layers.length === 0) return null

	return (
		<div className="border rounded-md">
			<div className="flex items-center gap-1 p-1.5 bg-muted/50">
				<button
					type="button"
					onClick={onToggleExpanded}
					className="cursor-pointer p-0.5 hover:bg-accent rounded transition-colors"
					title={expanded ? "Collapse group" : "Expand group"}
				>
					{expanded ? (
						<FolderOpen className="size-4" />
					) : (
						<Folder className="size-4" />
					)}
				</button>

				<button
					type="button"
					onClick={onToggleExpanded}
					className="flex-1 text-left font-medium cursor-pointer hover:underline"
				>
					{group.name}
				</button>

				<span className="text-muted-foreground">
					{visibleCount}/{group.layers.length}
				</span>

				<button
					type="button"
					onClick={() => onToggleGroup(group, noneVisible || !allVisible)}
					className="cursor-pointer p-0.5 hover:bg-accent rounded transition-colors"
					title={allVisible ? "Hide all layers" : "Show all layers"}
				>
					{allVisible ? (
						<Eye className="size-4" />
					) : noneVisible ? (
						<EyeOff className="size-4 text-muted-foreground" />
					) : (
						<Eye className="size-4 text-muted-foreground" />
					)}
				</button>

				<DropdownMenu>
					<DropdownMenuTrigger asChild>
						<button
							type="button"
							className="cursor-pointer p-0.5 hover:bg-accent rounded transition-colors"
							title="Layer type options"
						>
							<MoreVertical className="size-4" />
						</button>
					</DropdownMenuTrigger>
					<DropdownMenuContent align="end" className="w-48">
						<DropdownMenuItem onClick={() => onToggleGroup(group, true)}>
							<Eye className="size-4" />
							Show all layers
						</DropdownMenuItem>
						<DropdownMenuItem onClick={() => onToggleGroup(group, false)}>
							<EyeOff className="size-4" />
							Hide all layers
						</DropdownMenuItem>

						{availableTypes.length > 0 && (
							<>
								<DropdownMenuSeparator />
								{availableTypes.map((type) => {
									const { visible, total } = typeVisibility[type]
									const allTypeVisible = visible === total
									return (
										<DropdownMenuItem
											key={type}
											onClick={() => onToggleType(group, type, !allTypeVisible)}
										>
											{allTypeVisible ? (
												<EyeOff className="size-4" />
											) : (
												<Eye className="size-4" />
											)}
											{allTypeVisible ? "Hide" : "Show"} all{" "}
											{LAYER_TYPE_LABELS[type].toLowerCase()} ({visible}/{total}
											)
										</DropdownMenuItem>
									)
								})}
							</>
						)}
					</DropdownMenuContent>
				</DropdownMenu>
			</div>

			{expanded && (
				<div className="px-2 py-1">
					<div className="flex flex-col gap-y-0.5">
						{group.layers.map((layer) => (
							<div
								className="flex gap-1 justify-between w-full items-center"
								key={layer.id}
							>
								<button
									type="button"
									onClick={() => onToggleLayer(layer.id, layer.visible)}
									className="cursor-pointer rounded p-0.5 hover:bg-accent transition-colors"
									title={layer.visible ? "Hide layer" : "Show layer"}
								>
									{layer.visible ? (
										<Eye className="size-3.5" />
									) : (
										<EyeOff className="size-3.5 text-muted-foreground" />
									)}
								</button>
								<div className="truncate flex-1">{layer.id}</div>
								<div className="text-muted-foreground shrink-0">
									{layer.type}
								</div>
							</div>
						))}
					</div>
				</div>
			)}
		</div>
	)
}
