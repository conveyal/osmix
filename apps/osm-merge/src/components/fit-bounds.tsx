import { useAtomValue } from "jotai"
import { Button } from "./ui/button"
import { mapAtom } from "@/state/map"
import type { GeoBbox2D } from "osm.ts"
import { ExpandIcon } from "lucide-react"

export default function FitBounds({
	bounds,
}: {
	bounds?: maplibregl.LngLatBoundsLike | GeoBbox2D
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
					})
				}
			}}
			title="Fit bounds"
			variant="outline"
		>
			<ExpandIcon />
		</Button>
	)
}
