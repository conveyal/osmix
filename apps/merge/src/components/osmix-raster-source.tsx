import { Layer, Source } from "react-map-gl/maplibre"
import { addOsmixRasterProtocol } from "../lib/osmix-raster-protocol"
import { APPID, MIN_PICKABLE_ZOOM, RASTER_TILE_SIZE } from "../settings"

if (typeof window !== "undefined") {
	addOsmixRasterProtocol()
}

export default function OsmixRasterSource({
	osmId,
	tileSize = RASTER_TILE_SIZE,
}: {
	osmId: string
	tileSize?: number
}) {
	const id = `${APPID}:${osmId}:${tileSize}:raster`
	return (
		<Source
			id={id}
			type="raster"
			tiles={[`@osmix/raster://${osmId}/${tileSize}/{z}/{x}/{y}.png`]}
			tileSize={tileSize / 2}
		>
			<Layer id={id} type="raster" source={id} maxzoom={MIN_PICKABLE_ZOOM} />
		</Source>
	)
}
