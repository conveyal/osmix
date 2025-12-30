import { changeStatsSummary } from "@osmix/change"
import { useAtom, useSetAtom } from "jotai"
import {
	DownloadIcon,
	MaximizeIcon,
	MergeIcon,
	SaveIcon,
	SearchCode,
	XIcon,
} from "lucide-react"
import { Suspense, useEffect, useMemo, useRef } from "react"
import { useSearchParams } from "react-router"
import ActionButton from "../components/action-button"
import Basemap, { type MapInitialViewState } from "../components/basemap"
import CustomControl from "../components/custom-control"
import { Details, DetailsContent, DetailsSummary } from "../components/details"
import EntityDetailsMapControl from "../components/entity-details-map-control"
import FileSelectorScreen from "../components/file-selector-screen"
import { Main, MapContent, Sidebar } from "../components/layout"
import ChangesSummary, {
	ChangesFilters,
	ChangesList,
	ChangesPagination,
} from "../components/osm-changes-summary"
import OsmFileMapControl from "../components/osm-file-map-control"
import OsmInfoTable from "../components/osm-info-table"
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
import { BASE_OSM_KEY } from "../settings"
import { changesetStatsAtom } from "../state/changes"
import { Log } from "../state/log"
import { selectOsmEntityAtom } from "../state/osm"
import { osmWorker } from "../state/worker"

export default function InspectPage() {
	const [searchParams, setSearchParams] = useSearchParams()
	const flyToEntity = useFlyToEntity()
	const flyToOsmBounds = useFlyToOsmBounds()
	const baseOsm = useOsmFile(BASE_OSM_KEY)
	const selectEntity = useSetAtom(selectOsmEntityAtom)
	const [changesetStats, setChangesetStats] = useAtom(changesetStatsAtom)

	// Handle auto-loading from URL parameter
	const loadParamProcessed = useRef(false)
	useEffect(() => {
		const loadId = searchParams.get("load")
		if (loadId && !loadParamProcessed.current) {
			loadParamProcessed.current = true
			// Clear the URL parameter
			setSearchParams({}, { replace: true })
			// Load the file from storage
			baseOsm.loadFromStorage(loadId).then((osmInfo) => {
				if (osmInfo) {
					flyToOsmBounds(osmInfo)
				}
			})
		}
	}, [searchParams, setSearchParams, baseOsm.loadFromStorage, flyToOsmBounds])

	const applyChanges = async () => {
		if (!baseOsm.osm) throw Error("Osm has not been loaded.")
		const task = Log.startTask("Applying changes to OSM...")
		await osmWorker.applyChangesAndReplace(baseOsm.osm.id)
		task.update("Refreshing OSM index...")
		const newOsm = await osmWorker.get(baseOsm.osm.id)
		baseOsm.setOsm(newOsm)
		setChangesetStats(null)
		task.end("Changes applied!")
	}

	const hasZeroChanges = useMemo(() => {
		return changesetStats == null || changesetStats.totalChanges === 0
	}, [changesetStats])

	const openOsmFile = async (file: File | string) => {
		selectEntity(null, null)
		setChangesetStats(null)
		const osmInfo =
			typeof file === "string"
				? await baseOsm.loadFromStorage(file)
				: await baseOsm.loadOsmFile(file)
		flyToOsmBounds(osmInfo)
		return osmInfo
	}

	const initialViewState: MapInitialViewState | undefined = useMemo(() => {
		if (!baseOsm.osmInfo) return undefined
		const bbox = baseOsm?.osmInfo?.bbox
		if (!bbox) return undefined
		return {
			bounds: bbox,
			fitBoundsOptions: {
				padding: 100,
			},
		}
	}, [baseOsm.osmInfo])

	// Show full-screen file selector when no file is selected
	if (!baseOsm.osm || !baseOsm.osmInfo || !baseOsm.fileInfo) {
		return (
			<Main>
				<FileSelectorScreen openOsmFile={openOsmFile} />
			</Main>
		)
	}

	return (
		<Main>
			<Sidebar>
				<div className="flex flex-1 flex-col overflow-y-auto p-2 lg:p-4 gap-4">
					<Card>
						<CardHeader>
							<div className="font-bold uppercase p-2">
								{baseOsm.fileInfo?.fileName}
							</div>
							<ButtonGroup>
								{!baseOsm.isStored && (
									<ActionButton
										onAction={baseOsm.saveToStorage}
										variant="ghost"
										icon={<SaveIcon />}
										title="Save to storage"
									/>
								)}
								{changesetStats == null && (
									<ActionButton
										onAction={async () => {
											if (!baseOsm.osm) throw Error("Osm has not been loaded.")
											const task = Log.startTask(
												"Finding duplicate nodes and ways",
											)
											const changes = await osmWorker.generateChangeset(
												baseOsm.osm.id,
												baseOsm.osm.id,
												{
													deduplicateNodes: true,
													deduplicateWays: true,
												},
											)
											setChangesetStats(changes)
											task.end(changeStatsSummary(changes))
										}}
										icon={<SearchCode />}
										title="Find duplicate nodes and ways"
										variant="ghost"
									/>
								)}
								<ActionButton
									onAction={async () => {
										selectEntity(null, null)
										setChangesetStats(null)
										await baseOsm.loadOsmFile(null)
									}}
									icon={<XIcon />}
									title="Clear file"
									variant="ghost"
								/>
								<ActionButton
									onAction={baseOsm.downloadOsm}
									variant="ghost"
									icon={<DownloadIcon />}
									title="Download OSM PBF"
								/>
								<ActionButton
									onAction={async () => flyToOsmBounds(baseOsm.osmInfo)}
									variant="ghost"
									icon={<MaximizeIcon />}
									title="Fit bounds to file bbox"
								/>
							</ButtonGroup>
						</CardHeader>
						<CardContent>
							<OsmInfoTable
								file={baseOsm.file}
								fileInfo={baseOsm.fileInfo}
								osm={baseOsm.osm}
							/>
						</CardContent>
					</Card>

					{changesetStats != null && (
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
														if (!baseOsm.osm)
															throw Error("Osm has not been loaded.")
														selectEntity(baseOsm.osm, entity)
														flyToEntity(baseOsm.osm, entity)
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

					{!baseOsm.osm && (
						<StoredOsmList
							openOsmFile={openOsmFile}
							activeOsmId={baseOsm.osmInfo?.id}
						/>
					)}
				</div>
				<SidebarLog />
			</Sidebar>
			<MapContent>
				<Basemap initialViewState={initialViewState}>
					{baseOsm.osm && (
						<OsmixVectorOverlay
							key={`${baseOsm.osm.id}:overlay`}
							osm={baseOsm.osm}
						/>
					)}
					{baseOsm.osm && (
						<OsmixRasterSource
							key={`${baseOsm.osm.id}:raster`}
							osmId={baseOsm.osm.id}
						/>
					)}

					<TileBoundsLayer />

					<SelectedEntityLayer />
					<RouteLayer />

					<CustomControl position="top-left">
						<OsmFileMapControl
							files={[
								{
									osmFile: baseOsm,
									onClear: async () => {
										selectEntity(null, null)
										setChangesetStats(null)
										await baseOsm.loadOsmFile(null)
									},
								},
							]}
						/>
					</CustomControl>
					{baseOsm.osm && (
						<CustomControl position="top-left">
							<EntityDetailsMapControl osm={baseOsm.osm} />
						</CustomControl>
					)}
				</Basemap>
			</MapContent>
		</Main>
	)
}
