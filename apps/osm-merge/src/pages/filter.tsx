import Basemap from "@/components/basemap"
import CustomControl from "@/components/custom-control"
import DeckGlOverlay from "@/components/deckgl-overlay"
import { Details, DetailsContent, DetailsSummary } from "@/components/details"
import EntityDetailsMapControl from "@/components/entity-details-map-control"
import EntitySearchControl from "@/components/entity-search-control"
import ExtractList from "@/components/extract-list"
import { Main, MapContent, Sidebar } from "@/components/layout"
import ChangesSummary, {
	ChangesFilters,
	ChangesList,
	ChangesPagination,
} from "@/components/osm-changes-summary"
import OsmInfoTable from "@/components/osm-info-table"
import OsmPbfFileInput from "@/components/osm-pbf-file-input"
import { Button } from "@/components/ui/button"
import useStartTaskLog from "@/hooks/log"
import { usePickableOsmTileLayer, useSelectedEntityLayer } from "@/hooks/map"
import { useOsmFile } from "@/hooks/osm"
import { useSubscribeOsmWorkerToLog } from "@/hooks/log"
import { APPID } from "@/settings"
import { changesAtom } from "@/state/changes"
import { mapAtom } from "@/state/map"
import { selectOsmEntityAtom } from "@/state/osm"
import { bboxPolygon } from "@turf/turf"
import { useAtom, useAtomValue, useSetAtom } from "jotai"
import { MaximizeIcon } from "lucide-react"
import { useEffect, useMemo, useTransition } from "react"
import { Layer, Source } from "react-map-gl/maplibre"
import { useSearchParams } from "react-router"
import { osmWorker } from "@/state/worker"

export default function FilterPage() {
	const [searchParams] = useSearchParams()
	const osmId = useMemo(
		() => searchParams.get("osmId") ?? "inspect",
		[searchParams],
	)
	const map = useAtomValue(mapAtom)
	const {
		osm,
		isLoading: isLoadingFile,
		file,
		setFile,
		setOsm,
	} = useOsmFile(osmId, "./pbfs/monaco.pbf")
	const bbox = useMemo(() => osm?.bbox(), [osm])

	const selectEntity = useSetAtom(selectOsmEntityAtom)
	const tileLayer = usePickableOsmTileLayer(osm)
	const selectedEntityLayer = useSelectedEntityLayer()

	const [isTransitioning, startTransition] = useTransition()
	const startTask = useStartTaskLog()

	const [duplicateNodesAndWays, setDuplicateNodesAndWays] = useAtom(changesAtom)

	useEffect(() => {
		if (osm != null) {
			selectEntity(null, null)
			setDuplicateNodesAndWays(null)
		}
	}, [osm, selectEntity, setDuplicateNodesAndWays])

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
							if (file == null) setOsm(null)
						}}
					/>

					{osm && file ? (
						<div className="flex flex-col gap-2">
							<div className="flex flex-col">
								<div className="flex justify-between">
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
								<OsmInfoTable defaultOpen={false} file={file} osm={osm} />
							</div>

							<Button
								onClick={() => {
									startTransition(async () => {
										const task = startTask(
											"Finding duplicate nodes and ways",
											"info",
										)
										const changes = await osmWorker.dedupeNodesAndWays(osmId)
										setDuplicateNodesAndWays(changes)
										task.end(
											`${changes?.stats.deduplicatedNodes.toLocaleString()} nodes and ${changes?.stats.deduplicatedWays.toLocaleString()} ways found`,
											"ready",
										)
									})
								}}
							>
								Find duplicate nodes and ways
							</Button>

							{duplicateNodesAndWays && (
								<ChangesSummary>
									{/* Changes List */}
									<Details>
										<DetailsSummary>CHANGES</DetailsSummary>
										<DetailsContent>
											<ChangesFilters />
											<ChangesList
												setSelectedEntity={(entity) =>
													selectEntity(osm, entity)
												}
											/>
											<ChangesPagination />
										</DetailsContent>
									</Details>
								</ChangesSummary>
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
					{osm && (
						<CustomControl position="top-left">
							<EntityDetailsMapControl osm={osm} />
						</CustomControl>
					)}
				</Basemap>
			</MapContent>
		</Main>
	)
}
