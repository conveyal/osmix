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
import Basemap from "../components/basemap"
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
import { fetchOsmFileFromUrl } from "../lib/fetch-osm-file"
import { changesetStatsAtom } from "../state/changes"
import { Log } from "../state/log"
import { selectOsmEntityAtom } from "../state/osm"
import { osmWorker } from "../state/worker"

const EXAMPLE_MONACO_PBF_URL =
	"https://trevorgerhardt.github.io/files/487218b69358-1f24d3e4e476/monaco.pbf"

export default function InspectPage() {
	const [searchParams, setSearchParams] = useSearchParams()
	const flyToEntity = useFlyToEntity()
	const flyToOsmBounds = useFlyToOsmBounds()
	const {
		downloadOsm,
		isStored,
		osm,
		osmInfo,
		file,
		fileInfo,
		loadFromStorage,
		loadOsmFile,
		saveToStorage,
		setOsm,
	} = useOsmFile("inspect")
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
			loadFromStorage(loadId)
		}
	}, [searchParams, setSearchParams, loadFromStorage])

	// Automatically fit map bounds when osmInfo changes (after map is mounted)
	const lastFittedOsmId = useRef<string | null>(null)
	useEffect(() => {
		if (osmInfo && osmInfo.id !== lastFittedOsmId.current) {
			lastFittedOsmId.current = osmInfo.id
			flyToOsmBounds(osmInfo)
		}
	}, [osmInfo, flyToOsmBounds])

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

	const useExample = async () => {
		selectEntity(null, null)
		setChangesetStats(null)

		const task = Log.startTask("Downloading Monaco.pbf example...")
		try {
			const exampleFile = await fetchOsmFileFromUrl(EXAMPLE_MONACO_PBF_URL)
			task.update("Opening file...")
			await loadOsmFile(exampleFile)
			task.end("Example loaded")
		} catch (e) {
			const message = e instanceof Error ? e.message : "Unknown error"
			task.end(`Failed to load example: ${message}`, "error")
			throw e
		}
	}

	const openOsmFile = async (file: File | string) => {
		selectEntity(null, null)
		setChangesetStats(null)
		return typeof file === "string"
			? await loadFromStorage(file)
			: await loadOsmFile(file)
	}

	// Show full-screen file selector when no file is selected
	if (!osm || !osmInfo || !fileInfo) {
		return (
			<FileSelectorScreen
				title="OSM Inspect"
				description="Open an OSM file (PBF, GeoJSON, or Shapefile ZIP) to explore and inspect its contents."
				openOsmFile={openOsmFile}
				useExample={useExample}
			/>
		)
	}

	return (
		<Main>
			<Sidebar>
				<div className="flex flex-1 flex-col overflow-y-auto p-2 lg:p-4 gap-4">
					{osmInfo && fileInfo && (
						<>
							<Card>
								<CardHeader>
									<div className="font-bold uppercase p-2">
										{fileInfo.fileName}
									</div>
									<ButtonGroup>
										{!isStored && (
											<ActionButton
												onAction={saveToStorage}
												variant="ghost"
												icon={<SaveIcon />}
												title="Save to storage"
											/>
										)}
										<ActionButton
											onAction={async () => {
												selectEntity(null, null)
												setChangesetStats(null)
												await loadOsmFile(null)
											}}
											icon={<XIcon />}
											title="Clear file"
											variant="ghost"
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
									<OsmInfoTable file={file} fileInfo={fileInfo} osm={osm} />
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

					<StoredOsmList openOsmFile={openOsmFile} activeOsmId={osmInfo?.id} />
				</div>
				<SidebarLog />
			</Sidebar>
			<MapContent>
				<Basemap>
					{osm && <OsmixVectorOverlay key={`${osm.id}:overlay`} osm={osm} />}
					{osm && <OsmixRasterSource key={`${osm.id}:raster`} osmId={osm.id} />}

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
