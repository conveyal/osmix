import { useSetAtom } from "jotai"
import { useMemo } from "react"
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
import { useFlyToOsmBounds } from "../hooks/map"
import { useOsmFile } from "../hooks/osm"
import { BASE_OSM_KEY, PATCH_OSM_KEY } from "../settings"
import { changesetStatsAtom } from "../state/changes"
import { selectOsmEntityAtom } from "../state/osm"

export default function Merge() {
	const base = useOsmFile(BASE_OSM_KEY)
	const patch = useOsmFile(PATCH_OSM_KEY)
	const setChangesetStats = useSetAtom(changesetStatsAtom)
	const flyToOsmBounds = useFlyToOsmBounds()
	const selectEntity = useSetAtom(selectOsmEntityAtom)

	// Show full-screen file selector when no files are selected
	const noFilesSelected = !base.osm && !patch.osm

	const openOsmFile = async (file: File | string) => {
		selectEntity(null, null)
		setChangesetStats(null)
		const osmInfo =
			typeof file === "string"
				? await base.loadFromStorage(file)
				: await base.loadOsmFile(file)
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

	if (noFilesSelected) {
		return <FileSelectorScreen openOsmFile={openOsmFile} />
	}

	return (
		<Main>
			<Sidebar>
				<div className="flex flex-1 flex-col gap-4 overflow-y-auto p-4">
					<MergeBlock />
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

					<CustomControl position="top-left">
						<OsmFileMapControl
							files={[
								{
									label: "Base OSM",
									osmFile: base,
									onClear: async () => {
										selectEntity(null, null)
										setChangesetStats(null)
										await base.loadOsmFile(null)
									},
								},
								{
									label: "Patch OSM",
									osmFile: patch,
									onClear: async () => {
										selectEntity(null, null)
										setChangesetStats(null)
										await patch.loadOsmFile(null)
									},
								},
							]}
						/>
					</CustomControl>
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
