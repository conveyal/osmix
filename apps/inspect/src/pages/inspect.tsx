import { changeStatsSummary } from "@osmix/change"
import { ButtonGroup, ButtonGroupSeparator } from "@osmix/ui"
import { useAtom, useSetAtom } from "jotai"
import { DownloadIcon, MaximizeIcon, MergeIcon, SearchCode } from "lucide-react"
import { useMemo } from "react"
import ActionButton from "../components/action-button"
import Basemap from "../components/basemap"
import CustomControl from "../components/custom-control"
import { Details, DetailsContent, DetailsSummary } from "../components/details"
import EntityDetailsMapControl from "../components/entity-details-map-control"
import EntitySearchControl from "../components/entity-search-control"
import ExtractList from "../components/extract-list"
import { Main, MapContent, Sidebar } from "../components/layout"
import MapLayerControl from "../components/map-layer-control"
import NominatimSearchControl from "../components/nominatim-search-control"
import ChangesSummary, {
	ChangesFilters,
	ChangesList,
	ChangesPagination,
} from "../components/osm-changes-summary"
import OsmInfoTable from "../components/osm-info-table"
import OsmPbfFileInput from "../components/osm-pbf-file-input"
import OsmixRasterSource from "../components/osmix-raster-source"
import OsmixVectorOverlay from "../components/osmix-vector-overlay"
import RouteControl from "../components/route-control"
import RouteLayer from "../components/route-layer"
import SelectedEntityLayer from "../components/selected-entity-layer"
import SidebarLog from "../components/sidebar-log"
import TileBoundsLayer from "../components/tile-bounds-layer"
import { useFlyToEntity, useFlyToOsmBounds } from "../hooks/map"
import { useOsmFile } from "../hooks/osm"
import { changesetStatsAtom } from "../state/changes"
import { Log } from "../state/log"
import { selectOsmEntityAtom } from "../state/osm"
import { osmWorker } from "../state/worker"

const DEFAULT_OSM_ID = "inspect"
const DEFAULT_PBF_URL = "./monaco.pbf"

export default function InspectPage() {
	const osmId = DEFAULT_OSM_ID
	const flyToEntity = useFlyToEntity()
	const flyToOsmBounds = useFlyToOsmBounds()
	const { downloadOsm, osm, osmInfo, file, loadOsmFile, setOsm } = useOsmFile(
		osmId,
		DEFAULT_PBF_URL,
	)
	const selectEntity = useSetAtom(selectOsmEntityAtom)
	const [changesetStats, setChangesetStats] = useAtom(changesetStatsAtom)

	const applyChanges = async (osmId: string) => {
		const task = Log.startTask("Applying changes to OSM...")
		await osmWorker.applyChangesAndReplace(osmId)
		task.update("Refreshing OSM index...")
		const newOsm = await osmWorker.get(osmId)
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
							const osmInfo = await loadOsmFile(file)
							flyToOsmBounds(osmInfo)
						}}
					/>

					{osm && osmInfo && file ? (
						<div className="flex flex-col gap-2">
							<div className="flex flex-col">
								<div className="flex items-center justify-between border-l border-r border-t pl-2 rounded-t">
									<div className="font-bold">OPENSTREETMAP</div>
									<ButtonGroup>
										<ActionButton
											onAction={downloadOsm}
											variant="ghost"
											icon={<DownloadIcon />}
											title="Download OSM PBF"
										/>
										<ButtonGroupSeparator />
										<ActionButton
											onAction={async () => flyToOsmBounds(osmInfo)}
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
					{osm && <OsmixVectorOverlay osm={osm} />}
					{osm && <OsmixRasterSource osmId={osm.id} />}

					{import.meta.env.DEV && <TileBoundsLayer />}

					<SelectedEntityLayer />
					<RouteLayer />

					<CustomControl position="top-left">
						<NominatimSearchControl />
					</CustomControl>

					{import.meta.env.DEV && (
						<CustomControl position="bottom-left">
							<MapLayerControl />
						</CustomControl>
					)}

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
					{osm && (
						<CustomControl position="top-left">
							<RouteControl osm={osm} />
						</CustomControl>
					)}
				</Basemap>
			</MapContent>
		</Main>
	)
}
