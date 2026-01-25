import { Tabs } from "@base-ui/react/tabs"
import { useAtom, useSetAtom } from "jotai"
import { atomWithStorage } from "jotai/utils"
import type { OsmFileType } from "osmix"
import { useEffect, useMemo, useRef } from "react"
import { useSearchParams } from "react-router"
import InspectBlock from "../blocks/inspect"
import MergeBlock from "../blocks/merge"
import Basemap, { type MapInitialViewState } from "../components/basemap"
import CustomControl from "../components/custom-control"
import EntityDetailsMapControl from "../components/entity-details-map-control"
import FileSelectorScreen from "../components/file-selector-screen"
import { Main, MapContent, Sidebar } from "../components/layout"
import OsmFileMapControl from "../components/osm-file-map-control"
import OsmixRasterSource from "../components/osmix-raster-source"
import OsmixVectorOverlay from "../components/osmix-vector-overlay"
import SelectedEntityLayer from "../components/selected-entity-layer"
import SidebarLog from "../components/sidebar-log"
import { buttonVariants } from "../components/ui/button"
import { useLog } from "../hooks/log"
import { useFlyToOsmBounds } from "../hooks/map"
import { useOsmFile } from "../hooks/osm"
import { cn } from "../lib/utils"
import { BASE_OSM_KEY, PATCH_OSM_KEY } from "../settings"
import { changesetStatsAtom } from "../state/changes"

const activeTabAtom = atomWithStorage<string>(
	"@osmix:merge:activeTab",
	"Inspect",
)

import { selectOsmEntityAtom } from "../state/osm"
import { osmWorker } from "../state/worker"

export default function Merge() {
	const base = useOsmFile(BASE_OSM_KEY)
	const patch = useOsmFile(PATCH_OSM_KEY)
	const setChangesetStats = useSetAtom(changesetStatsAtom)
	const flyToOsmBounds = useFlyToOsmBounds()
	const selectEntity = useSetAtom(selectOsmEntityAtom)
	const autoLoadAttempted = useRef(false)
	const [searchParams, setSearchParams] = useSearchParams()
	const { activeTasks } = useLog()
	const isMergeInProgress = activeTasks > 0
	const [activeTab, setActiveTab] = useAtom(activeTabAtom)

	// Handle auto-loading from URL parameter or most recently used file
	useEffect(() => {
		if (autoLoadAttempted.current) return
		autoLoadAttempted.current = true

		const loadId = searchParams.get("load")
		if (loadId) {
			// Clear the URL parameter
			setSearchParams({}, { replace: true })
			// Load the file from storage
			base.loadFromStorage(loadId).then((osmInfo) => {
				if (osmInfo) {
					flyToOsmBounds(osmInfo)
				}
			})
		} else {
			// No URL parameter, try to load the most recently used file
			osmWorker.getMostRecentlyUsed().then((mostRecent) => {
				if (mostRecent) {
					base.loadFromStorage(mostRecent.fileHash).then((osmInfo) => {
						flyToOsmBounds(osmInfo)
					})
				}
			})
		}
	}, [searchParams, setSearchParams, base.loadFromStorage, flyToOsmBounds])

	// Show full-screen file selector when no files are selected
	const noFilesSelected = !base.osm && !patch.osm

	const openOsmFile = async (file: File | string, fileType?: OsmFileType) => {
		selectEntity(null, null)
		setChangesetStats(null)
		const osmInfo =
			typeof file === "string"
				? await base.loadFromStorage(file)
				: await base.loadOsmFile(file, fileType)
		flyToOsmBounds(osmInfo)
		return osmInfo
	}

	const initialViewState: MapInitialViewState | undefined = useMemo(() => {
		if (!base.osmInfo) return undefined
		const bbox = base?.osmInfo?.bbox
		if (!bbox) return undefined
		return {
			bounds: bbox,
			fitBoundsOptions: {
				padding: 100,
			},
		}
	}, [base.osmInfo])

	if (noFilesSelected) return <FileSelectorScreen openOsmFile={openOsmFile} />

	return (
		<Main>
			<Sidebar>
				<div className="flex-1 p-2 lg:p-4 overflow-y-auto">
					<Tabs.Root value={activeTab} onValueChange={setActiveTab}>
						<Tabs.List className="flex gap-2 pb-2">
							<Tabs.Tab
								className={cn(
									buttonVariants({ variant: "outline", size: "sm" }),
									"data-active:border-accent-foreground",
									isMergeInProgress && "opacity-50 cursor-not-allowed",
								)}
								disabled={isMergeInProgress}
								value="Inspect"
							>
								Inspect
							</Tabs.Tab>
							<Tabs.Tab
								className={cn(
									buttonVariants({ variant: "outline", size: "sm" }),
									"data-active:border-primary",
									isMergeInProgress && "opacity-50 cursor-not-allowed",
								)}
								disabled={isMergeInProgress}
								value="Merge"
							>
								Merge
							</Tabs.Tab>
						</Tabs.List>
						<Tabs.Panel value="Inspect">
							<InspectBlock />
						</Tabs.Panel>
						<Tabs.Panel value="Merge">
							<MergeBlock />
						</Tabs.Panel>
					</Tabs.Root>
				</div>
				<SidebarLog />
			</Sidebar>
			<MapContent>
				<Basemap initialViewState={initialViewState}>
					{base.osm && <OsmixRasterSource osmId={base.osm.id} />}
					{patch.osm && <OsmixRasterSource osmId={patch.osm.id} />}
					{base.osm && <OsmixVectorOverlay osm={base.osm} />}
					{patch.osm && <OsmixVectorOverlay osm={patch.osm} />}

					<SelectedEntityLayer />

					<OsmFileMapControl
						files={[
							{
								osmFile: base,
								onClear: async () => {
									selectEntity(null, null)
									setChangesetStats(null)
									if (patch.osm) {
										// Capture patch state before clearing to avoid duplicate source ids
										const patchState = {
											file: patch.file,
											fileInfo: patch.fileInfo,
											osm: patch.osm,
											osmInfo: patch.osmInfo,
											isStored: patch.isStored,
										}
										// Clear patch first to remove it from the map
										await patch.loadOsmFile(null)
										// Then transfer captured state to base
										base.copyStateFrom(patchState)
									} else {
										await base.loadOsmFile(null)
									}
								},
							},
							{
								osmFile: patch,
								onClear: async () => {
									selectEntity(null, null)
									setChangesetStats(null)
									await patch.loadOsmFile(null)
								},
							},
						]}
					/>
					{base.osm && (
						<CustomControl position="top-left">
							<EntityDetailsMapControl osm={base.osm} />
						</CustomControl>
					)}
				</Basemap>
			</MapContent>
		</Main>
	)
}
