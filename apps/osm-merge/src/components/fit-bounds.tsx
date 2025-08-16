import { useAtomValue } from "jotai"
import { Button } from "./ui/button"
import { mapAtom } from "@/state/map"
import type { GeoBbox2D } from "osm.ts"
import { MaximizeIcon } from "lucide-react"

export default function FitBounds({
	bounds,
	options,
}: {
	bounds?: maplibregl.LngLatBoundsLike | GeoBbox2D
	options?: maplibregl.FitBoundsOptions
}) {
	const map = useAtomValue(mapAtom)
	return (
		<Button
			size="icon"
			onClick={() => {
				if (map && bounds) {
					map.fitBounds(bounds, {
						padding: 100,
						maxDuration: 200,
						...options,
					})
				}
			}}
			title="Fit bounds"
			variant="outline"
		>
			<MaximizeIcon />
		</Button>
	)
}
