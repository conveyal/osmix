import type { DeckProps } from "@deck.gl/core"
import { MapboxOverlay } from "@deck.gl/mapbox"
import { useEffect } from "react"
import { useControl } from "react-map-gl/maplibre"

export default function DeckGlOverlay(props: DeckProps) {
	const overlay = useControl<MapboxOverlay>(() => new MapboxOverlay(props))

	useEffect(() => {
		overlay.setProps(props)
	}, [overlay, props])
	return null
}
