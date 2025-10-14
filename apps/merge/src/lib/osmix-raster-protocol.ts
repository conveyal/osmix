import {
	createOsmixRasterMaplibreProtocol,
	RASTER_PROTOCOL_NAME,
} from "@osmix/raster"
import maplibre from "maplibre-gl"
import { RASTER_TILE_SIZE } from "@/settings"
import { osmWorker } from "@/state/worker"

export function addOsmixRasterProtocol() {
	maplibre.addProtocol(
		RASTER_PROTOCOL_NAME,
		createOsmixRasterMaplibreProtocol(osmWorker.getTileImage, RASTER_TILE_SIZE),
	)
}

export function removeOsmixRasterProtocol() {
	maplibre.removeProtocol(RASTER_PROTOCOL_NAME)
}
