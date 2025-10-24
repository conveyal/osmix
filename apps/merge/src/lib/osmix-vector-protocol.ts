import type { AddProtocolAction } from "maplibre-gl"
import maplibre from "maplibre-gl"
import { osmWorker } from "@/state/worker"

const VECTOR_PROTOCOL_NAME = "@osmix/vector"
const VECTOR_URL_PATTERN =
	/^@osmix\/vector:\/\/([^/]+)\/(\d+)\/(\d+)\/(\d+)\.mvt$/

let registered = false

const createProtocolHandler = (): AddProtocolAction => {
	return async (
		req,
	): Promise<maplibregl.GetResourceResponse<ArrayBuffer | null>> => {
		const match = VECTOR_URL_PATTERN.exec(req.url)
		if (!match) throw new Error(`Bad @osmix/vector URL: ${req.url}`)
		const [, osmId, zStr, xStr, yStr] = match
		const tileIndex = {
			z: +zStr,
			x: +xStr,
			y: +yStr,
		}
		const data = await osmWorker.getVectorTile(osmId, tileIndex)
		return {
			data,
			cacheControl: import.meta.env.DEV ? "no-cache" : "force-cache",
			expires: new Date(Date.now() + 1000 * 60 * 60 * 24),
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
