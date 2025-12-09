import type { Osm } from "@osmix/core"
import { useAtom } from "jotai"
import { MaximizeIcon, XIcon } from "lucide-react"
import { useFlyToEntity } from "../hooks/map"
import { MIN_PICKABLE_ZOOM } from "../settings"
import { selectedEntityAtom } from "../state/osm"
import EntityDetails from "./entity-details"
import { Button } from "./ui/button"

export default function EntityMapControl({ osm }: { osm: Osm }) {
	const [selectedEntity, setSelectedEntity] = useAtom(selectedEntityAtom)
	const flyToEntity = useFlyToEntity()
	if (selectedEntity == null) {
		return (
			<div className="p-2 text-center font-bold">
				SEARCH OR SELECT ENTITY ON MAP (Z{MIN_PICKABLE_ZOOM} AND UP)
			</div>
		)
	}
	return (
		<>
			<div className="flex items-center justify-between gap-2 border-b">
				<div className="font-bold pl-2">SELECTED ENTITY</div>
				<div className="flex items-center">
					<Button
						onClick={() => {
							setSelectedEntity(null)
						}}
						variant="ghost"
						size="icon-sm"
						title="Clear selection"
					>
						<XIcon />
					</Button>
					<Button
						onClick={() => {
							flyToEntity(osm, selectedEntity)
						}}
						variant="ghost"
						size="icon-sm"
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
		</>
	)
}
