import { useAtomValue } from "jotai"
import { MinusIcon, PlusIcon } from "lucide-react"
import { useMap } from "../hooks/map"
import { zoomAtom } from "../state/map"
import { Button } from "./ui/button"

export default function ZoomInfo() {
	const zoom = useAtomValue(zoomAtom)
	return <>{zoom?.toFixed(2)}</>
}

export function ZoomInButton() {
	const map = useMap()
	return (
		<Button onClick={() => map?.zoomIn()} size="icon-sm" variant="ghost">
			<PlusIcon />
		</Button>
	)
}

export function ZoomOutButton() {
	const map = useMap()
	return (
		<Button onClick={() => map?.zoomOut()} size="icon-sm" variant="ghost">
			<MinusIcon />
		</Button>
	)
}
