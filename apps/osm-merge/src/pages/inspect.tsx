import CustomControl from "@/components/custom-control"
import EntitySearchControl from "@/components/entity-search-control"
import ExtractList from "@/components/extract-list"
import {
	useFlyToEntity,
	useFlyToOsmBounds,
	usePickableOsmTileLayer,
	useSelectedEntityLayer,
} from "@/hooks/map"
import { useOsmFile } from "@/hooks/osm"
import { APPID, MIN_PICKABLE_ZOOM } from "@/settings"
import { addLogMessageAtom } from "@/state/log"
import {
	selectOsmEntityAtom,
	selectedEntityAtom,
	selectedOsmAtom,
} from "@/state/osm"
import { bboxPolygon } from "@turf/turf"
import { useAtomValue, useSetAtom } from "jotai"
import { MaximizeIcon } from "lucide-react"
import * as Performance from "osm.ts/performance"
import { useEffect, useMemo } from "react"
import { Layer, Source } from "react-map-gl/maplibre"
import { useSearchParams } from "react-router"
import Basemap from "../components/basemap"
import DeckGlOverlay from "../components/deckgl-overlay"
import EntityDetails from "../components/entity-details"
import { Main, MapContent, Sidebar } from "../components/layout"
import OsmInfoTable from "../components/osm-info-table"
import OsmPbfFileInput from "../components/osm-pbf-file-input"
import { Button } from "../components/ui/button"

export default function InspectPage() {
	const [searchParams] = useSearchParams()
	const osmId = useMemo(
		() => searchParams.get("osmId") ?? "inspect",
		[searchParams],
	)
	const { osm, isLoading: isLoadingFile, file, setFile } = useOsmFile(osmId)
	const bbox = useMemo(() => osm?.bbox(), [osm])
	const logMessage = useSetAtom(addLogMessageAtom)

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
	}, [file, setFile])

	const selectedOsm = useAtomValue(selectedOsmAtom)
	const selectedEntity = useAtomValue(selectedEntityAtom)
	const selectEntity = useSetAtom(selectOsmEntityAtom)
	const tileLayer = usePickableOsmTileLayer(osm)
	const selectedEntityLayer = useSelectedEntityLayer()
	const flyToEntity = useFlyToEntity()
	const flyToOsmBounds = useFlyToOsmBounds()

	return (
		<Main>
			<Sidebar>
				<div className="flex flex-col p-4 gap-4">
					<OsmPbfFileInput
						isLoading={isLoadingFile}
						file={file}
						setFile={(file) => {
							selectEntity(null, null)
							setFile(file)
						}}
					/>

					{osm && file ? (
						<div className="flex flex-col gap-2">
							<div className="flex flex-col">
								<div className="flex justify-between">
									<div className="font-bold">OPENSTREETMAP PBF</div>
									<Button
										onClick={() => flyToOsmBounds(osm)}
										variant="ghost"
										size="icon"
										className="size-4"
										title="Fit bounds to file bbox"
									>
										<MaximizeIcon />
									</Button>
								</div>
								<OsmInfoTable file={file} osm={osm} />
							</div>
							{selectedOsm == null || selectedEntity == null ? (
								<div className="px-1 text-center font-bold">
									SELECT ENTITY ON MAP (Z{MIN_PICKABLE_ZOOM} AND UP)
								</div>
							) : (
								<div>
									<div className="flex justify-between">
										<div className="font-bold">SELECTED ENTITY</div>
										<Button
											onClick={() => {
												flyToEntity(selectedOsm, selectedEntity)
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
										osm={selectedOsm}
										onSelect={(entity) => selectEntity(selectedOsm, entity)}
									/>
								</div>
							)}
						</div>
					) : (
						<div className="flex flex-col gap-2">
							<ExtractList />
						</div>
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
					{osm && (
						<CustomControl position="top-left">
							<EntitySearchControl osm={osm} />
						</CustomControl>
					)}
				</Basemap>
			</MapContent>
		</Main>
	)
}
