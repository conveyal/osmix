import { usePickableOsmTileLayer, useSelectedEntityLayer } from "@/hooks/map"
import { useOsmFile } from "@/hooks/osm"
import { APPID, MIN_PICKABLE_ZOOM } from "@/settings"
import { addLogMessageAtom } from "@/state/log"
import { mapAtom, selectedEntityAtom } from "@/state/map"
import { bboxPolygon } from "@turf/turf"
import { useAtomValue, useSetAtom } from "jotai"
import { MaximizeIcon } from "lucide-react"
import * as Performance from "osm.ts/performance"
import { useEffect, useMemo, useState } from "react"
import { Layer, Source } from "react-map-gl/maplibre"
import Basemap from "../components/basemap"
import DeckGlOverlay from "../components/deckgl-overlay"
import EntityDetails from "../components/entity-details"
import { Main, MapContent, Sidebar } from "../components/layout"
import OsmInfoTable from "../components/osm-info-table"
import OsmPbfFileInput from "../components/osm-pbf-file-input"
import { Button } from "../components/ui/button"
import { useSearchParams } from "react-router"

export default function ViewPage() {
	const [searchParams] = useSearchParams()
	const [file, setFile] = useState<File | null>(null)
	const osmId = useMemo(
		() => file?.name ?? searchParams.get("osmId") ?? "inspect",
		[file, searchParams],
	)
	const map = useAtomValue(mapAtom)
	const { osm, isLoading: isLoadingFile } = useOsmFile(osmId, file)
	const bbox = useMemo(() => osm?.bbox(), [osm])
	const logMessage = useSetAtom(addLogMessageAtom)
	const setSelectedEntity = useSetAtom(selectedEntityAtom)

	// Set message to "Ready" when the application is ready
	useEffect(() => {
		logMessage("Ready", "ready")
		Performance.mark("Ready")
	}, [logMessage])

	// Auto load default file for faster testing
	useEffect(() => {
		if (process.env.NODE_ENV !== "development") return
		if (!file) {
			fetch("./pbfs/monaco.pbf")
				.then((res) => res.blob())
				.then((blob) => {
					setFile((file) => (file ? file : new File([blob], "monaco.pbf")))
				})
		}
	}, [file])

	const { layer: tileLayer, selectedEntity } = usePickableOsmTileLayer(osm)
	const selectedEntityLayer = useSelectedEntityLayer(osm)

	return (
		<Main>
			<Sidebar>
				<div className="flex flex-col p-4 gap-2">
					<OsmPbfFileInput
						isLoading={isLoadingFile}
						file={file}
						setFile={(file) => {
							setSelectedEntity(null)
							setFile(file)
						}}
					/>

					{osm && file && (
						<>
							<div className="px-1 flex justify-between">
								<div className="font-bold">OPENSTREETMAP PBF</div>
								<Button
									onClick={() => {
										const bbox = osm.bbox()
										if (bbox)
											map?.fitBounds(bbox, {
												padding: 100,
												maxDuration: 0,
											})
									}}
									variant="ghost"
									size="icon"
									className="size-4"
									title="Fit bounds to file bbox"
								>
									<MaximizeIcon />
								</Button>
							</div>
							<OsmInfoTable file={file} osm={osm} />
							{selectedEntity == null ? (
								<div className="px-1 text-center font-bold">
									SELECT ENTITY ON MAP (Z{MIN_PICKABLE_ZOOM} AND UP)
								</div>
							) : (
								<div>
									<div className="px-1 flex justify-between">
										<div className="font-bold">SELECTED ENTITY</div>
										<Button
											onClick={() => {
												const bbox = osm?.getEntityBbox(selectedEntity)
												if (bbox)
													map?.fitBounds(bbox, {
														padding: 100,
														maxDuration: 0,
													})
											}}
											variant="ghost"
											size="icon"
											className="size-4"
											title="Fit bounds to entity"
										>
											<MaximizeIcon />
										</Button>
									</div>
									<EntityDetails
										entity={selectedEntity}
										osm={osm}
										onSelect={setSelectedEntity}
									/>
								</div>
							)}
						</>
					)}
				</div>
			</Sidebar>
			<MapContent>
				<Basemap>
					{bbox && (
						<Source type="geojson" data={bboxPolygon(bbox)}>
							<Layer
								type="line"
								paint={{ "line-color": "red", "line-width": 10 }}
							/>
						</Source>
					)}
					<DeckGlOverlay
						layers={[tileLayer, selectedEntityLayer]}
						pickingRadius={5}
						getTooltip={(pickingInfo) => {
							const sourceLayerId = pickingInfo.sourceLayer?.id
							if (sourceLayerId?.startsWith(`${APPID}:${osmId}`)) {
								if (sourceLayerId.includes("nodes")) {
									return {
										className: "deck-tooltip",
										html: `<h3 className="p-2">node</h3>`,
									}
								}
								if (sourceLayerId.includes("ways")) {
									return {
										className: "deck-tooltip",
										html: `<h3 className="p-2">way</h3>`,
									}
								}
							}
							return null
						}}
					/>
				</Basemap>
			</MapContent>
		</Main>
	)
}
