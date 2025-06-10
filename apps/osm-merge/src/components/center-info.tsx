import { useAtomValue } from "jotai"
import { mapCenterAtom } from "@/atoms"

export default function CenterInfo() {
	const center = useAtomValue(mapCenterAtom)
	return (
		<>
			{center?.lng.toFixed(4) ?? "--"}, {center?.lat.toFixed(4) ?? "--"}
		</>
	)
}
