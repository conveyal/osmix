import { Layer, Source } from "react-map-gl/maplibre"
import { addOsmixRasterProtocol } from "@/lib/osmix-raster-protocol"
import { APPID, MIN_PICKABLE_ZOOM, RASTER_TILE_SIZE } from "@/settings"

if (typeof window !== "undefined") {
	addOsmixRasterProtocol()
}

export default function OsmixRasterSource({ osmId }: { osmId: string }) {
	const id = `${APPID}:${osmId}:raster`
	return (
		<Source
			id={id}
			type="raster"
			tiles={[`@osmix/raster://${osmId}/{z}/{x}/{y}.png`]}
			tileSize={RASTER_TILE_SIZE}
		>
			<Layer id={id} type="raster" source={id} maxzoom={MIN_PICKABLE_ZOOM} />
		</Source>
	)
}
