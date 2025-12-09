import type { Osm } from "@osmix/core"
import { useSetAtom } from "jotai"
import { useFlyToEntity } from "../hooks/map"
import { selectedEntityAtom, selectedOsmAtom } from "../state/osm"
import { getOsmixEntityByStringId } from "../utils"
import EntityLookup from "./entity-lookup"

export default function EntitySearchControl({ osm }: { osm: Osm }) {
	const flyToEntity = useFlyToEntity()
	const setSelectedOsm = useSetAtom(selectedOsmAtom)
	const setSelectedEntity = useSetAtom(selectedEntityAtom)
	return (
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
	)
}
