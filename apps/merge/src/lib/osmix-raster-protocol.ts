import {
	createOsmixRasterMaplibreProtocol,
	RASTER_PROTOCOL_NAME,
} from "@osmix/raster"
import maplibre from "maplibre-gl"
import { osmWorker } from "../state/worker"

export function addOsmixRasterProtocol() {
	maplibre.addProtocol(
		RASTER_PROTOCOL_NAME,
		createOsmixRasterMaplibreProtocol(osmWorker.getTileImage),
	)
}

export function removeOsmixRasterProtocol() {
	maplibre.removeProtocol(RASTER_PROTOCOL_NAME)
}
