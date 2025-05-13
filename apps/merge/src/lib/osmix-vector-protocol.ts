import type { Tile } from "@osmix/shared/types"
import type { AddProtocolAction } from "maplibre-gl"
import maplibre from "maplibre-gl"
import { osmWorker } from "../state/worker"

const VECTOR_PROTOCOL_NAME = "@osmix/vector"
const VECTOR_URL_PATTERN =
	/^@osmix\/vector:\/\/([^/]+)\/(\d+)\/(\d+)\/(\d+)\.mvt$/

let registered = false

const createProtocolHandler = (): AddProtocolAction => {
	return async (
		req,
		abortController,
	): Promise<maplibregl.GetResourceResponse<ArrayBuffer | null>> => {
		const match = VECTOR_URL_PATTERN.exec(req.url)
		if (!match) throw new Error(`Bad @osmix/vector URL: ${req.url}`)
		const [, osmId, zStr, xStr, yStr] = match
		const tileIndex: Tile = [+xStr, +yStr, +zStr]
		const data = await osmWorker.getVectorTile(osmId, tileIndex)

		return {
			data: abortController.signal.aborted ? null : data,
			cacheControl: "no-cache",
		}
	}
}

export function addOsmixVectorProtocol() {
	if (registered) return
	maplibre.addProtocol(VECTOR_PROTOCOL_NAME, createProtocolHandler())
	registered = true
}

export function removeOsmixVectorProtocol() {
	if (!registered) return
	maplibre.removeProtocol(VECTOR_PROTOCOL_NAME)
	registered = false
}
