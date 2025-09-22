import { MIN_PICKABLE_ZOOM } from "@/settings"
import { mapAtom, selectedEntityAtom } from "@/state/map"
import { useAtom, useAtomValue } from "jotai"
import type { Osm } from "osm.ts"
import { Button } from "./ui/button"
import { MaximizeIcon } from "lucide-react"
import EntityDetails from "./entity-details"

export default function EntityMapControl({ osm }: { osm: Osm }) {
	const [selectedEntity, setSelectedEntity] = useAtom(selectedEntityAtom)
	const map = useAtomValue(mapAtom)
	return (
		<div className="flex flex-col gap-2 bg-background w-sm max-h-[50lvh] overflow-y-auto">
			{selectedEntity == null ? (
				<div className="px-1 text-center font-bold py-1">
					SEARCH OR SELECT ENTITY ON MAP (Z{MIN_PICKABLE_ZOOM} AND UP)
				</div>
			) : (
				<div>
					<div className="flex items-center justify-between px-2 pt-1">
						<div className="font-bold">SELECTED ENTITY</div>
						<Button
							onClick={() => {
								const bbox = osm?.getEntityBbox(selectedEntity)
								if (bbox)
									map?.fitBounds(bbox, {
										padding: 100,
										maxDuration: 0,
									})
							}}
							variant="ghost"
							size="icon"
							className="size-4"
							title="Fit bounds to entity"
						>
							<MaximizeIcon />
						</Button>
					</div>
					<div className="overflow-x-auto">
						<EntityDetails
							entity={selectedEntity}
							osm={osm}
							onSelect={setSelectedEntity}
						/>
					</div>
				</div>
			)}
		</div>
	)
}
