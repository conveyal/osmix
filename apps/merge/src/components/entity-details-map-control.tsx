import type { Osm } from "@osmix/core"
import { useAtom, useSetAtom } from "jotai"
import { MaximizeIcon, XIcon } from "lucide-react"
import { useFlyToEntity } from "../hooks/map"
import { MIN_PICKABLE_ZOOM } from "../settings"
import { selectedEntityAtom, selectedOsmAtom } from "../state/osm"
import { getOsmixEntityByStringId } from "../utils"
import EntityDetails from "./entity-details"
import EntityLookup from "./entity-lookup"
import { Button } from "./ui/button"

export default function EntityMapControl({ osm }: { osm: Osm }) {
	const [selectedEntity, setSelectedEntity] = useAtom(selectedEntityAtom)
	const setSelectedOsm = useSetAtom(selectedOsmAtom)
	const flyToEntity = useFlyToEntity()
	return (
		<>
			<EntityLookup
				setSelectedEntity={(id) => {
					const entity = getOsmixEntityByStringId(osm, id)
					setSelectedOsm(osm)
					setSelectedEntity(entity)
					if (entity) {
						flyToEntity(osm, entity)
					}
					return entity
				}}
			/>
			{selectedEntity === null ? (
				<div className="p-2 text-center font-bold">
					{" "}
					SEARCH OR SELECT ENTITY ON MAP (Z{MIN_PICKABLE_ZOOM} AND UP)
				</div>
			) : (
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
							defaultOpen={false}
							osm={osm}
							onSelect={setSelectedEntity}
						/>
					</div>
				</>
			)}
		</>
	)
}
