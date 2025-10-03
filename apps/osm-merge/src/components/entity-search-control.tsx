import type { Osm } from "@osmix/core"
import { useSetAtom } from "jotai"
import { useFlyToEntity } from "@/hooks/map"
import { selectedEntityAtom } from "@/state/osm"
import EntityLookup from "./entity-lookup"

export default function EntitySearchControl({ osm }: { osm: Osm }) {
	const flyToEntity = useFlyToEntity()
	const setSelectedEntity = useSetAtom(selectedEntityAtom)
	return (
		<div className="bg-background w-sm">
			<EntityLookup
				setSelectedEntity={(id) => {
					const entity = osm.getById(id)
					setSelectedEntity(entity)
					if (entity) {
						flyToEntity(osm, entity)
					}
					return entity
				}}
			/>
		</div>
	)
}
