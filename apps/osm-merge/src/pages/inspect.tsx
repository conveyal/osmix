import { bboxPolygon } from "@turf/turf"
import { useAtom, useSetAtom } from "jotai"
import {
	DownloadIcon,
	Loader2Icon,
	MaximizeIcon,
	MergeIcon,
	SearchCode,
} from "lucide-react"
import { showSaveFilePicker } from "native-file-system-adapter"
import { Osm, writeOsmToPbfStream } from "osm.ts"
import { useCallback, useEffect, useMemo, useTransition } from "react"
import { Layer, Source } from "react-map-gl/maplibre"
import { useSearchParams } from "react-router"
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
import {
	useFlyToEntity,
	useFlyToOsmBounds,
	usePickableOsmTileLayer,
	useSelectedEntityLayer,
} from "@/hooks/map"
import { useOsmFile } from "@/hooks/osm"
import { APPID } from "@/settings"
import { changesAtom } from "@/state/changes"
import { selectOsmEntityAtom } from "@/state/osm"
import { osmWorker } from "@/state/worker"

export default function InspectPage() {
	const [searchParams] = useSearchParams()
	const osmId = useMemo(
		() => searchParams.get("osmId") ?? "inspect",
		[searchParams],
	)
	const flyToEntity = useFlyToEntity()
	const flyToOsmBounds = useFlyToOsmBounds()
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

	const downloadOsm = useCallback(
		async (osm: Osm, name?: string) => {
			startTransition(async () => {
				const task = startTask("Generating OSM file to download")
				const suggestedName =
					name ?? (osm.id.endsWith(".pbf") ? osm.id : `${osm.id}.pbf`)
				const fileHandle = await showSaveFilePicker({
					suggestedName,
					types: [
						{
							description: "OSM PBF",
							accept: { "application/x-protobuf": [".pbf"] },
						},
					],
				})
				const stream = await fileHandle.createWritable()
				await writeOsmToPbfStream(osm, stream)
				task.end(`Created ${fileHandle.name} PBF for download`)
			})
		},
		[startTask],
	)

	const applyChanges = useCallback(
		async (osmId: string) => {
			const task = startTask("Applying changes to OSM...")
			startTransition(async () => {
				const transferables = await osmWorker.applyChangesAndReplace(osmId)
				task.update("Refreshing OSM index...")
				const newOsm = Osm.from(transferables)
				setOsm(newOsm)
				task.end("Changes applied!")
			})
		},
		[setOsm, startTask],
	)

	const hasZeroChanges = useMemo(() => {
		if (!duplicateNodesAndWays) return true
		return (
			Object.keys(duplicateNodesAndWays.nodes).length === 0 &&
			Object.keys(duplicateNodesAndWays.ways).length === 0 &&
			Object.keys(duplicateNodesAndWays.relations).length === 0
		)
	}, [duplicateNodesAndWays])

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
								<div className="flex items-center justify-between border-l border-r border-t pl-2">
									<div className="font-bold">OPENSTREETMAP PBF</div>
									<div className="flex gap-2">
										<Button
											disabled={isTransitioning}
											onClick={() => downloadOsm(osm)}
											variant="ghost"
											size="icon"
											title="Download OSM PBF"
										>
											<DownloadIcon />
										</Button>
										<Button
											disabled={isTransitioning}
											onClick={() => flyToOsmBounds(osm)}
											variant="ghost"
											size="icon"
											title="Fit bounds to file bbox"
										>
											<MaximizeIcon />
										</Button>
									</div>
								</div>
								<OsmInfoTable file={file} osm={osm} />
							</div>

							{duplicateNodesAndWays == null ? (
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
												`Found ${changes?.stats.deduplicatedNodes.toLocaleString()} duplicate nodes and ${changes?.stats.deduplicatedWays.toLocaleString()} duplicate ways`,
												"ready",
											)
										})
									}}
									disabled={isTransitioning}
								>
									{isTransitioning ? (
										<Loader2Icon className="animate-spin" />
									) : (
										<SearchCode />
									)}
									Find duplicate nodes and ways
								</Button>
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
										<Button
											onClick={() => applyChanges(osm.id)}
											disabled={isTransitioning}
										>
											{isTransitioning ? (
												<Loader2Icon className="animate-spin" />
											) : (
												<MergeIcon />
											)}
											Apply changes
										</Button>
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
