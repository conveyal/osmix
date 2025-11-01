import type { Osmix } from "@osmix/core"
import { useAtom } from "jotai"
import { MaximizeIcon, XIcon } from "lucide-react"
import { useFlyToEntity } from "../hooks/map"
import { MIN_PICKABLE_ZOOM } from "../settings"
import { selectedEntityAtom } from "../state/osm"
import EntityDetails from "./entity-details"
import { Button } from "./ui/button"

export default function EntityMapControl({ osm }: { osm: Osmix }) {
	const [selectedEntity, setSelectedEntity] = useAtom(selectedEntityAtom)
	const flyToEntity = useFlyToEntity()
	return (
		<div className="flex flex-col gap-2 bg-background w-sm max-h-[50lvh] overflow-y-auto">
			{selectedEntity == null ? (
				<div className="px-1 text-center font-bold py-1">
					SEARCH OR SELECT ENTITY ON MAP (Z{MIN_PICKABLE_ZOOM} AND UP)
				</div>
			) : (
				<div>
					<div className="flex items-center justify-between pl-2">
						<div className="font-bold">SELECTED ENTITY</div>
						<div className="flex items-center">
							<Button
								onClick={() => {
									setSelectedEntity(null)
								}}
								variant="ghost"
								size="icon"
								title="Clear selection"
							>
								<XIcon />
							</Button>
							<Button
								onClick={() => {
									flyToEntity(osm, selectedEntity)
								}}
								variant="ghost"
								size="icon"
								title="Fit bounds to entity"
							>
								<MaximizeIcon />
							</Button>
						</div>
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
