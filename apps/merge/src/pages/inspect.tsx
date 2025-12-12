import { changeStatsSummary } from "@osmix/change"
import { useAtom, useSetAtom } from "jotai"
import { DownloadIcon, MaximizeIcon, MergeIcon, SearchCode } from "lucide-react"
import { Suspense, useMemo } from "react"
import ActionButton from "../components/action-button"
import Basemap from "../components/basemap"
import CustomControl from "../components/custom-control"
import { Details, DetailsContent, DetailsSummary } from "../components/details"
import EntityDetailsMapControl from "../components/entity-details-map-control"
import ExtractList from "../components/extract-list"
import { Main, MapContent, Sidebar } from "../components/layout"
import ChangesSummary, {
	ChangesFilters,
	ChangesList,
	ChangesPagination,
} from "../components/osm-changes-summary"
import OsmInfoTable from "../components/osm-info-table"
import {
	OsmPbfClearFileButton,
	OsmPbfSelectFileButton,
} from "../components/osm-pbf-file-input"
import OsmixRasterSource from "../components/osmix-raster-source"
import OsmixVectorOverlay from "../components/osmix-vector-overlay"
import RouteLayer from "../components/route-layer"
import SelectedEntityLayer from "../components/selected-entity-layer"
import SidebarLog from "../components/sidebar-log"
import StoredOsmList from "../components/stored-osm-list"
import TileBoundsLayer from "../components/tile-bounds-layer"
import { ButtonGroup } from "../components/ui/button-group"
import { Card, CardContent, CardHeader } from "../components/ui/card"
import { useFlyToEntity, useFlyToOsmBounds } from "../hooks/map"
import { useOsmFile } from "../hooks/osm"
import { changesetStatsAtom } from "../state/changes"
import { Log } from "../state/log"
import { selectOsmEntityAtom } from "../state/osm"
import { osmWorker } from "../state/worker"

export default function InspectPage() {
	const flyToEntity = useFlyToEntity()
	const flyToOsmBounds = useFlyToOsmBounds()
	const {
		downloadOsm,
		osm,
		osmInfo,
		file,
		loadFromStorage,
		loadOsmFile,
		setOsm,
	} = useOsmFile("inspect", "./monaco.pbf")
	const selectEntity = useSetAtom(selectOsmEntityAtom)
	const [changesetStats, setChangesetStats] = useAtom(changesetStatsAtom)

	const applyChanges = async () => {
		if (!osm) throw Error("Osm has not been loaded.")
		const task = Log.startTask("Applying changes to OSM...")
		await osmWorker.applyChangesAndReplace(osm.id)
		task.update("Refreshing OSM index...")
		const newOsm = await osmWorker.get(osm.id)
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
				<div className="flex flex-1 flex-col overflow-y-auto p-2 lg:p-4 gap-4">
					{!osm || !osmInfo ? (
						<>
							<OsmPbfSelectFileButton
								setFile={async (f) => {
									selectEntity(null, null)
									setChangesetStats(null)
									const info = await loadOsmFile(f)
									flyToOsmBounds(info)
								}}
							/>
							<StoredOsmList
								onLoad={async (id) => {
									selectEntity(null, null)
									setChangesetStats(null)
									const info = await loadFromStorage(id)
									flyToOsmBounds(info ?? undefined)
									return info
								}}
								activeOsmId={osmInfo?.id}
							/>
							<ExtractList />
						</>
					) : (
						<>
							<Card>
								<CardHeader>
									<div className="font-bold uppercase p-2">FILE</div>
									<ButtonGroup>
										<OsmPbfClearFileButton
											clearFile={async () => {
												selectEntity(null, null)
												setChangesetStats(null)
												await loadOsmFile(null)
											}}
										/>
										<ActionButton
											onAction={downloadOsm}
											variant="ghost"
											icon={<DownloadIcon />}
											title="Download OSM PBF"
										/>
										<ActionButton
											onAction={async () => flyToOsmBounds(osmInfo)}
											variant="ghost"
											icon={<MaximizeIcon />}
											title="Fit bounds to file bbox"
										/>
									</ButtonGroup>
								</CardHeader>
								<CardContent>
									<OsmInfoTable file={file} osm={osm} />
								</CardContent>
							</Card>

							{changesetStats == null ? (
								<ActionButton
									onAction={async () => {
										const task = Log.startTask(
											"Finding duplicate nodes and ways",
										)
										const changes = await osmWorker.generateChangeset(
											osm.id,
											osm.id,
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
									<Card>
										<CardHeader className="p-2">Changeset</CardHeader>
										<CardContent>
											<ChangesSummary />
											<Suspense
												fallback={<div className="py-1 px-2">LOADING...</div>}
											>
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
											</Suspense>
										</CardContent>
									</Card>

									{!hasZeroChanges && (
										<ActionButton
											className="w-full"
											onAction={applyChanges}
											icon={<MergeIcon />}
										>
											Apply changes
										</ActionButton>
									)}
								</>
							)}
						</>
					)}
				</div>
				<SidebarLog />
			</Sidebar>
			<MapContent>
				<Basemap>
					{osm && <OsmixVectorOverlay osm={osm} />}
					{osm && <OsmixRasterSource osmId={osm.id} />}

					<TileBoundsLayer />

					<SelectedEntityLayer />
					<RouteLayer />

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
