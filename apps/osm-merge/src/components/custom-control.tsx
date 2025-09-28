import * as React from "react"
import { cloneElement, useState } from "react"
import { createPortal } from "react-dom"
import type {
	ControlPosition,
	IControl,
	MapInstance,
} from "react-map-gl/maplibre"
import { useControl } from "react-map-gl/maplibre"

class OverlayControl implements IControl {
	_map: MapInstance | null = null
	_container: HTMLElement | null = null
	_redraw: () => void

	constructor(redraw: () => void) {
		this._redraw = redraw
	}

	onAdd(map: MapInstance) {
		this._map = map
		map.on("move", this._redraw)
		/* global document */
		this._container = document.createElement("div")
		this._container.className = "maplibregl-ctrl"
		this._redraw()
		return this._container
	}

	onRemove() {
		this._container?.remove()
		this._map?.off("move", this._redraw)
		this._map = null
	}

	getMap() {
		return this._map
	}

	getElement() {
		return this._container
	}
}

/**
 * A custom control that rerenders arbitrary React content whenever the camera changes
 */
function CustomControl(props: {
	children: React.ReactElement<{ map: MapInstance }>
	position?: ControlPosition
}) {
	const [, setVersion] = useState(0)

	const ctrl = useControl<OverlayControl>(
		() => {
			const forceUpdate = () => setVersion((v) => v + 1)
			return new OverlayControl(forceUpdate)
		},
		{ position: props.position },
	)

	const map = ctrl.getMap()
	const el = ctrl.getElement()

	return map && el && createPortal(cloneElement(props.children, { map }), el)
}

export default React.memo(CustomControl)
