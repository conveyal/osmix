import { useAtomValue } from "jotai"
import { zoomAtom } from "@/atoms"

export default function ZoomInfo() {
	const zoom = useAtomValue(zoomAtom)
	return <>{zoom?.toFixed(2)}</>
}
