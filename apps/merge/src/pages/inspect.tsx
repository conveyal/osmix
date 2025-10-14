import { changeStatsSummary } from "@osmix/change"
import { Osmix } from "@osmix/core"
import { bboxPolygon } from "@turf/bbox-polygon"
import { useAtom, useSetAtom } from "jotai"
import { DownloadIcon, MaximizeIcon, MergeIcon, SearchCode } from "lucide-react"
import { useMemo } from "react"
import { Layer, Source } from "react-map-gl/maplibre"
import { useSearchParams } from "react-router"
import ActionButton from "@/components/action-button"
import Basemap from "@/components/basemap"
import CustomControl from "@/components/custom-control"
import DeckGlOverlay from "@/components/deckgl-overlay"
import { Details, DetailsContent, DetailsSummary } from "@/components/details"
import EntityDetailsMapControl from "@/components/entity-details-map-control"
import EntitySearchControl from "@/components/entity-search-control"
import ExtractList from "@/components/extract-list"
import { Main, MapContent, Sidebar } from "@/components/layout"
import NominatimSearchControl from "@/components/nominatim-search-control"
import ChangesSummary, {
	ChangesFilters,
	ChangesList,
	ChangesPagination,
} from "@/components/osm-changes-summary"
import OsmInfoTable from "@/components/osm-info-table"
import OsmPbfFileInput from "@/components/osm-pbf-file-input"
import OsmixRasterSource from "@/components/osmix-raster-source"
import SidebarLog from "@/components/sidebar-log"
import { ButtonGroup, ButtonGroupSeparator } from "@/components/ui/button-group"
import {
	useFlyToEntity,
	useFlyToOsmBounds,
	usePickableOsmTileLayer,
	useSelectedEntityLayer,
} from "@/hooks/map"
import { useOsmFile } from "@/hooks/osm"
import { APPID } from "@/settings"
import { changesetStatsAtom } from "@/state/changes"
import { Log } from "@/state/log"
import { selectOsmEntityAtom } from "@/state/osm"
import { osmWorker } from "@/state/worker"

const deckTooltipStyle: Partial<CSSStyleDeclaration> = {
	backgroundColor: "white",
	padding: "0",
	color: "var(--slate-950)",
}

export default function InspectPage() {
	const [searchParams] = useSearchParams()
	const osmId = useMemo(
		() => searchParams.get("osmId") ?? "inspect",
		[searchParams],
	)
	const flyToEntity = useFlyToEntity()
	const flyToOsmBounds = useFlyToOsmBounds()
	const { downloadOsm, osm, file, loadOsmFile, setOsm } = useOsmFile(
		osmId,
		"./monaco.pbf",
	)
	const bbox = useMemo(() => osm?.bbox(), [osm])
	const selectEntity = useSetAtom(selectOsmEntityAtom)
	const tileLayer = usePickableOsmTileLayer(osm)
	const selectedEntityLayer = useSelectedEntityLayer()
	const [changesetStats, setChangesetStats] = useAtom(changesetStatsAtom)

	const applyChanges = async (osmId: string) => {
		const task = Log.startTask("Applying changes to OSM...")
		const transferables = await osmWorker.applyChangesAndReplace(osmId)
		task.update("Refreshing OSM index...")
		const newOsm = Osmix.from(transferables)
		setOsm(newOsm)
		setChangesetStats(null)
		task.end("Changes applied!")
	}

	const hasZeroChanges = useMemo(() => {
		return changesetStats == null || changesetStats.totalChanges === 0
	}, [changesetStats])

	return (
		<Main>
			<Sidebar>
				<div className="flex flex-1 flex-col gap-4 overflow-y-auto p-4">
					<OsmPbfFileInput
						testId="inspect-file"
						file={file}
						setFile={async (file) => {
							selectEntity(null, null)
							setChangesetStats(null)
							const osm = await loadOsmFile(file)
							flyToOsmBounds(osm)
						}}
					/>

					{osm && file ? (
						<div className="flex flex-col gap-2">
							<div className="flex flex-col">
								<div className="flex items-center justify-between border-l border-r border-t pl-2 rounded-t">
									<div className="font-bold">OPENSTREETMAP PBF</div>
									<ButtonGroup>
										<ActionButton
											onAction={downloadOsm}
											variant="ghost"
											icon={<DownloadIcon />}
											title="Download OSM PBF"
										/>
										<ButtonGroupSeparator />
										<ActionButton
											onAction={async () => flyToOsmBounds(osm)}
											variant="ghost"
											icon={<MaximizeIcon />}
											title="Fit bounds to file bbox"
										/>
									</ButtonGroup>
								</div>
								<OsmInfoTable file={file} osm={osm} />
							</div>

							{changesetStats == null ? (
								<ActionButton
									onAction={async () => {
										const task = Log.startTask(
											"Finding duplicate nodes and ways",
										)
										const changes = await osmWorker.generateChangeset(
											osmId,
											osmId,
											{
												deduplicateNodes: true,
												deduplicateWays: true,
											},
										)
										setChangesetStats(changes)
										task.end(changeStatsSummary(changes))
									}}
									icon={<SearchCode />}
								>
									Find duplicate nodes and ways
								</ActionButton>
							) : (
								<>
									<ChangesSummary>
										{/* Changes List */}
										<Details>
											<DetailsSummary>CHANGES</DetailsSummary>
											<DetailsContent>
												<ChangesFilters />
												<ChangesList
													setSelectedEntity={(entity) => {
														selectEntity(osm, entity)
														flyToEntity(osm, entity)
													}}
												/>
												<ChangesPagination />
											</DetailsContent>
										</Details>
									</ChangesSummary>

									{!hasZeroChanges && (
										<ActionButton
											onAction={() => applyChanges(osm.id)}
											icon={<MergeIcon />}
										>
											Apply changes
										</ActionButton>
									)}
								</>
							)}
						</div>
					) : (
						<div className="flex flex-col gap-2">
							<ExtractList />
						</div>
					)}
				</div>
				<SidebarLog />
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
										style: deckTooltipStyle,
										html: `<div className="p-2">node</div>`,
									}
								}
								if (sourceLayerId.includes("ways")) {
									return {
										className: "deck-tooltip",
										style: deckTooltipStyle,
										html: `<div className="p-2">way</div>`,
									}
								}
							}
							return null
						}}
					/>
					{osm && <OsmixRasterSource osmId={osm.id} />}

					<CustomControl position="top-left">
						<NominatimSearchControl />
					</CustomControl>

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
