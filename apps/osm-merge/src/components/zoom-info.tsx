import { zoomAtom } from "@/atoms"
import { useAtomValue } from "jotai"

export default function ZoomInfo() {
	const zoom = useAtomValue(zoomAtom)
	return <>{zoom?.toFixed(2)}</>
}
