import { baseGeoJsonLayerAtom } from "@/atoms"
import Basemap from "@/components/basemap"
import DeckGlOverlay from "@/components/deckgl-overlay"
import { useAtomValue } from "jotai"
import { objectToHtmlTableString, layerIdToName } from "../utils"
import OsmPbfFilePicker from "@/components/filepicker"

export default function ViewPage() {
	const baseGeoJsonLayer = useAtomValue(baseGeoJsonLayerAtom)

	return (
		<div className="flex flex-row grow-1 h-full overflow-hidden">
			<div className="flex flex-col w-96 gap-4 py-4 overflow-y-auto">
				<OsmPbfFilePicker category="base" />
			</div>
			<div className="relative grow-3">
				<Basemap>
					<DeckGlOverlay
						layers={[baseGeoJsonLayer]}
						getTooltip={(pi) => {
							if (!pi.object) return null
							// console.log(pi)
							return {
								className: "deck-tooltip",
								html: `
                                    <h3>${layerIdToName(pi.layer?.id ?? "")}</h3>
                                    <hr />
                                    <h3>${pi.object.geometry.type === "Point" ? "Node" : "Way"}: ${pi.object.id}</h3>
                                    <table><tbody>${objectToHtmlTableString(pi.object.properties)}</tbody></table>
                                    `,
							}
						}}
					/>
				</Basemap>
			</div>
		</div>
	)
}
