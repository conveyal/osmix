import { atom, useAtom } from "jotai"
import { useEffect, useRef } from "react"
import { Layer, Source } from "react-map-gl/maplibre"
import { addOsmixRasterProtocol } from "@/lib/osmix-raster-protocol"
import { APPID, MIN_PICKABLE_ZOOM, RASTER_TILE_SIZE } from "@/settings"

const protocolInstalledAtom = atom(false)

function useOsmixRasterProtocol() {
	const [protocolInstalled, setProtocolInstalled] = useAtom(
		protocolInstalledAtom,
	)
	const installedRef = useRef(false)

	useEffect(() => {
		if (installedRef.current || protocolInstalled) {
			return
		}
		installedRef.current = true
		setProtocolInstalled(true)
		addOsmixRasterProtocol()
	}, [protocolInstalled, setProtocolInstalled])
}

export default function OsmixRasterSource({ osmId }: { osmId: string }) {
	useOsmixRasterProtocol()
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
