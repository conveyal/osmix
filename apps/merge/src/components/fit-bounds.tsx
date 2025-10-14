import type { GeoBbox2D } from "@osmix/json"
import { useAtomValue } from "jotai"
import { MaximizeIcon } from "lucide-react"
import { mapAtom } from "@/state/map"
import { Button } from "./ui/button"

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
