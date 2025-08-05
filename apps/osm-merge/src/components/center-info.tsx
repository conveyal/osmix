import { mapCenterAtom } from "@/state/map"
import { useAtomValue } from "jotai"

export default function CenterInfo() {
	const center = useAtomValue(mapCenterAtom)
	return (
		<>
			{center?.lng.toFixed(4) ?? "--"}, {center?.lat.toFixed(4) ?? "--"}
		</>
	)
}
