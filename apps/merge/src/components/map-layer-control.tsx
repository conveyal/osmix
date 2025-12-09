import { ChevronDown, Eye, EyeOff, Layers } from "lucide-react"
import { Fragment, useCallback, useEffect, useMemo, useState } from "react"
import { useMap } from "../hooks/map"
import { cn } from "../lib/utils"
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

export default function MapLayerControl() {
	const map = useMap()
	const [layers, setLayers] = useState<LayerInfo[]>([])
	const [searchQuery, setSearchQuery] = useState("")
	const [isOpen, setIsOpen] = useState(false)

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

	// Filter layers by search query
	const filteredLayers = useMemo(() => {
		if (!searchQuery.trim()) return layers
		const query = searchQuery.toLowerCase()
		return layers.filter((layer) => layer.id.toLowerCase().includes(query))
	}, [layers, searchQuery])

	// Toggle layer visibility
	const toggleLayerVisibility = (
		layerId: string,
		currentlyVisible: boolean,
	) => {
		if (!map) return
		const newVisibility = currentlyVisible ? "none" : "visible"
		map.getMap().setLayoutProperty(layerId, "visibility", newVisibility)
		refreshLayers()
	}

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
					<span className="text-muted-foreground">{filteredLayers.length}</span>
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

				<div className="max-h-80 overflow-y-auto space-y-1">
					{filteredLayers.length === 0 ? (
						<div className="text-muted-foreground text-sm text-center py-2">
							No layers found
						</div>
					) : (
						<div className="grid grid-cols-[auto_1fr] gap-x-2 gap-y-1 items-center first:mt-2 last:mb-2">
							{filteredLayers.map((layer) => (
								<Fragment key={layer.id}>
									<button
										type="button"
										onClick={() =>
											toggleLayerVisibility(layer.id, layer.visible)
										}
										className="cursor-pointer rounded p-1 hover:bg-accent transition-colors"
										title={layer.visible ? "Hide layer" : "Show layer"}
									>
										{layer.visible ? (
											<Eye className="size-4" />
										) : (
											<EyeOff className="size-4 text-muted-foreground" />
										)}
									</button>
									<div className="truncate" title={layer.id}>
										{layer.id}
									</div>
								</Fragment>
							))}
						</div>
					)}
				</div>
			</CollapsibleContent>
		</Collapsible>
	)
}
