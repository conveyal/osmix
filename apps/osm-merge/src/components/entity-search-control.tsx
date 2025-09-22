import { mapAtom, selectedEntityAtom } from "@/state/map"
import { useAtomValue, useSetAtom } from "jotai"
import type { Osm } from "osm.ts"
import EntityLookup from "./entity-lookup"

export default function EntitySearchControl({ osm }: { osm: Osm }) {
	const map = useAtomValue(mapAtom)
	const setSelectedEntity = useSetAtom(selectedEntityAtom)
	return (
		<div className="bg-background w-sm">
			<EntityLookup
				setSelectedEntity={(id) => {
					const entity = osm.getById(id)
					setSelectedEntity(entity)
					if (map && entity) {
						const bbox = osm.getEntityBbox(entity)
						map.fitBounds(bbox, {
							padding: 100,
							maxDuration: 0,
						})
					}
					return entity
				}}
			/>
		</div>
	)
}
