import { useAtomValue } from "jotai"
import { zoomAtom } from "../state/map"

export default function ZoomInfo() {
	const zoom = useAtomValue(zoomAtom)
	return <>{zoom?.toFixed(2)}</>
}
