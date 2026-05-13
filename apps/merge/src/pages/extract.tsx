import type { GeoBbox2D } from "@osmix/shared/types"
import { useAtomValue, useSetAtom } from "jotai"
import { Info } from "lucide-react"
import type { ExtractStrategy } from "osmix"
import { useEffect, useMemo, useState } from "react"
import type { MapInstance } from "react-map-gl/maplibre"
import Basemap, { type MapInitialViewState } from "../components/basemap"
import CustomControl from "../components/custom-control"
import ExtractBboxCornerMarkers, {
	bboxAfterCornerDrag,
} from "../components/extract-bbox-corner-markers"
import ExtractBboxLayer from "../components/extract-bbox-layer"
import ExtractTagFilterEditor, {
	conveyalTagFilterEditorState,
	rulesFromEditorState,
	type TagFilterEditorState,
} from "../components/extract-tag-filter-editor"
import { Main, MapContent, Sidebar } from "../components/layout"
import { NominatimSearch } from "../components/nominatim-search-control"
import OsmPbfFileInput from "../components/osm-pbf-file-input"
import OsmixRasterSource from "../components/osmix-raster-source"
import OsmixVectorOverlay from "../components/osmix-vector-overlay"
import SidebarLog from "../components/sidebar-log"
import { Button } from "../components/ui/button"
import { Card, CardContent, CardHeader } from "../components/ui/card"
import { Input } from "../components/ui/input"
import { useLog } from "../hooks/log"
import { useFlyToOsmBounds, useMap } from "../hooks/map"
import { useOsmFile } from "../hooks/osm"
import { cn } from "../lib/utils"
import { EXTRACT_OSM_KEY } from "../settings"
import { mapBoundsAtom } from "../state/map"
import { selectOsmEntityAtom } from "../state/osm"
import { osmLoadingAbortControllerAtom } from "../state/status"

/** Initial map viewport around default merge basemap (Yakima area). */
const DEFAULT_EXTRACT_BBOX: GeoBbox2D = [-121.65, 46.45, -120.35, 47.25]

function isValidBbox(bbox: GeoBbox2D): boolean {
	const [w, s, e, n] = bbox
	if (![w, s, e, n].every((x) => Number.isFinite(x))) return false
	if (w >= e || s >= n) return false
	if (w < -180 || e > 180 || s < -90 || n > 90) return false
	return true
}

function parseBboxString(raw: string): GeoBbox2D | null {
	const parts = raw.split(",").map((p) => Number.parseFloat(p.trim()))
	if (parts.length !== 4 || parts.some((x) => !Number.isFinite(x))) return null
	const candidate = parts as GeoBbox2D
	return isValidBbox(candidate) ? candidate : null
}

function boundsLikeToBbox(
	bounds: maplibregl.LngLatBounds | null,
): GeoBbox2D | null {
	if (!bounds) return null
	const [sw, ne] = bounds.toArray() as [[number, number], [number, number]]
	const [w, s] = sw
	const [e, n] = ne
	const bbox: GeoBbox2D = [w, s, e, n]
	return isValidBbox(bbox) ? bbox : null
}

const STRATEGY_OPTIONS: {
	value: ExtractStrategy
	label: string
	hint: string
}[] = [
	{
		value: "simple",
		label: "Simple",
		hint: "Strict bbox cut; geometries may be incomplete at the boundary.",
	},
	{
		value: "complete_ways",
		label: "Complete ways",
		hint: "Keep full way geometry; includes nodes outside the bbox when needed.",
	},
	{
		value: "smart",
		label: "Smart",
		hint: "Like complete ways, and resolves multipolygon relations completely.",
	},
]

function StrategyInfoTooltip({
	label,
	description,
}: {
	label: string
	description: string
}) {
	return (
		<span className="relative inline-flex shrink-0 group">
			<button
				type="button"
				className="text-muted-foreground hover:text-foreground rounded-full p-0.5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
				aria-label={`About ${label} extract strategy`}
			>
				<Info className="size-3.5" aria-hidden />
			</button>
			<span
				role="tooltip"
				className={cn(
					"pointer-events-none absolute right-full top-1/2 z-100 mr-1.5 w-56 -translate-y-1/2 rounded-md border bg-popover px-2.5 py-1.5  font-normal text-popover-foreground shadow-md",
					"opacity-0 invisible transition-opacity",
					"group-hover:opacity-100 group-hover:visible group-focus-within:opacity-100 group-focus-within:visible",
				)}
			>
				{description}
			</span>
		</span>
	)
}

function ExtractMapSearch({
	onBoundingPlace,
}: {
	onBoundingPlace: (bbox: GeoBbox2D) => void
}) {
	const map = useMap()
	return (
		<CustomControl position="top-right">
			<NominatimSearch
				map={(map ?? undefined) as MapInstance | undefined}
				onPlaceResolved={(result) => {
					const bbox = result.boundingbox?.map(Number)
					if (bbox && bbox.length === 4 && bbox.every(Number.isFinite)) {
						const [latSouth, latNorth, lonWest, lonEast] = bbox as [
							number,
							number,
							number,
							number,
						]
						onBoundingPlace([lonWest, latSouth, lonEast, latNorth])
					}
				}}
			/>
		</CustomControl>
	)
}

export default function ExtractPage() {
	const extract = useOsmFile(EXTRACT_OSM_KEY)
	const flyToOsmBounds = useFlyToOsmBounds()
	const selectEntity = useSetAtom(selectOsmEntityAtom)
	const setLoadingState = useSetAtom(osmLoadingAbortControllerAtom)
	const mapBounds = useAtomValue(mapBoundsAtom)
	const { activeTasks } = useLog()

	const [bbox, setBbox] = useState<GeoBbox2D>(DEFAULT_EXTRACT_BBOX)
	const [bboxText, setBboxText] = useState("")
	const [bboxInputs, setBboxInputs] = useState(() =>
		DEFAULT_EXTRACT_BBOX.map((v) => String(v)),
	)
	const [strategy, setStrategy] = useState<ExtractStrategy>("complete_ways")
	const [tagFilterEditor, setTagFilterEditor] = useState<TagFilterEditorState>(
		conveyalTagFilterEditorState,
	)
	const [pendingFile, setPendingFile] = useState<File | null>(null)
	const [syncMapToBbox, setSyncMapToBbox] = useState(false)

	const isExtracting = activeTasks > 0

	useEffect(() => {
		const [w, s, e, n] = bbox
		setBboxInputs([String(w), String(s), String(e), String(n)])
	}, [bbox])

	useEffect(() => {
		if (!syncMapToBbox) return
		const next = boundsLikeToBbox(mapBounds)
		if (next) setBbox(next)
	}, [mapBounds, syncMapToBbox])

	useEffect(() => {
		if (extract.osmInfo) flyToOsmBounds(extract.osmInfo)
	}, [extract.osmInfo, flyToOsmBounds])

	const initialViewState: MapInitialViewState | undefined = useMemo(() => {
		if (extract.osmInfo?.bbox) {
			const b = extract.osmInfo.bbox
			return {
				bounds: b,
				fitBoundsOptions: { padding: 100 },
			}
		}
		return {
			bounds: DEFAULT_EXTRACT_BBOX,
			fitBoundsOptions: { padding: 80 },
		}
	}, [extract.osmInfo])

	const canExtract = !!pendingFile && isValidBbox(bbox) && !isExtracting

	const applyParsedBboxString = () => {
		const parsed = parseBboxString(bboxText)
		if (parsed) setBbox(parsed)
	}

	const useMapViewAsBbox = () => {
		const next = boundsLikeToBbox(mapBounds)
		if (next) setBbox(next)
	}

	const runExtract = async () => {
		if (!pendingFile || !canExtract) return
		selectEntity(null, null)
		const abortController = new AbortController()
		setLoadingState({ controller: abortController, osmKey: EXTRACT_OSM_KEY })
		try {
			await extract.loadExtractFromPbf(
				pendingFile,
				{
					extractBbox: bbox,
					extractStrategy: strategy,
					extractTagFilter: rulesFromEditorState(tagFilterEditor),
				},
				abortController.signal,
			)
		} finally {
			setLoadingState(null)
		}
	}

	return (
		<Main>
			<Sidebar>
				<div className="flex-1 p-2 overflow-y-auto flex flex-col gap-4">
					<Card>
						<CardHeader className="p-2">1. Select bounding box</CardHeader>
						<CardContent className="p-2 flex flex-col gap-2">
							<p className="text-muted-foreground">
								Search on the map (top right), or edit coordinates below. The
								rectangle updates on the map.
							</p>
							<div className="grid grid-cols-2 gap-2">
								<label
									className=" flex flex-col gap-1"
									htmlFor="extract-bbox-min-lon"
								>
									Min longitude
									<Input
										id="extract-bbox-min-lon"
										type="number"
										step="any"
										value={bboxInputs[0]}
										onChange={(e) => {
											const v = e.target.value
											setBboxInputs((prev) => [v, prev[1], prev[2], prev[3]])
											const n = Number.parseFloat(v)
											if (Number.isFinite(n))
												setBbox((b) => [n, b[1], b[2], b[3]])
										}}
									/>
								</label>
								<label
									className=" flex flex-col gap-1"
									htmlFor="extract-bbox-min-lat"
								>
									Min latitude
									<Input
										id="extract-bbox-min-lat"
										type="number"
										step="any"
										value={bboxInputs[1]}
										onChange={(e) => {
											const v = e.target.value
											setBboxInputs((prev) => [prev[0], v, prev[2], prev[3]])
											const n = Number.parseFloat(v)
											if (Number.isFinite(n))
												setBbox((b) => [b[0], n, b[2], b[3]])
										}}
									/>
								</label>
								<label
									className=" flex flex-col gap-1"
									htmlFor="extract-bbox-max-lon"
								>
									Max longitude
									<Input
										id="extract-bbox-max-lon"
										type="number"
										step="any"
										value={bboxInputs[2]}
										onChange={(e) => {
											const v = e.target.value
											setBboxInputs((prev) => [prev[0], prev[1], v, prev[3]])
											const n = Number.parseFloat(v)
											if (Number.isFinite(n))
												setBbox((b) => [b[0], b[1], n, b[3]])
										}}
									/>
								</label>
								<label
									className=" flex flex-col gap-1"
									htmlFor="extract-bbox-max-lat"
								>
									Max latitude
									<Input
										id="extract-bbox-max-lat"
										type="number"
										step="any"
										value={bboxInputs[3]}
										onChange={(e) => {
											const v = e.target.value
											setBboxInputs((prev) => [prev[0], prev[1], prev[2], v])
											const n = Number.parseFloat(v)
											if (Number.isFinite(n))
												setBbox((b) => [b[0], b[1], b[2], n])
										}}
									/>
								</label>
							</div>
							<div className="flex flex-col gap-2">
								<label
									className=" text-muted-foreground"
									htmlFor="extract-bbox-paste"
								>
									Paste bbox{" "}
									<code className="text-[10px] bg-muted px-1 rounded">
										min_lon,min_lat,max_lon,max_lat
									</code>
								</label>
								<div className="flex gap-2">
									<Input
										id="extract-bbox-paste"
										value={bboxText}
										onChange={(e) => setBboxText(e.target.value)}
										placeholder="-122.5,47.2,-122.3,47.5"
										className="font-mono "
									/>
									<Button
										type="button"
										variant="secondary"
										size="sm"
										onClick={applyParsedBboxString}
									>
										Parse
									</Button>
								</div>
							</div>
							<div className="flex flex-wrap gap-2 mt-2">
								<Button
									type="button"
									variant="outline"
									size="sm"
									onClick={useMapViewAsBbox}
								>
									Use current map view as bbox
								</Button>
								<label className="flex items-center gap-2  cursor-pointer">
									<input
										type="checkbox"
										checked={syncMapToBbox}
										onChange={(e) => setSyncMapToBbox(e.target.checked)}
									/>
									Keep bbox synced while panning/zooming
								</label>
							</div>
							{!isValidBbox(bbox) ? (
								<p className=" text-destructive mt-1">
									Bbox must have min &lt; max for both lon and lat.
								</p>
							) : null}
						</CardContent>
					</Card>

					<Card>
						<CardHeader className="p-2">2. Extract strategy</CardHeader>
						<CardContent className="p-2">
							{STRATEGY_OPTIONS.map((opt) => {
								const inputId = `extract-strategy-${opt.value}`
								return (
									<div
										key={opt.value}
										className={cn(
											"flex items-center gap-2 rounded border p-2 ",
											strategy === opt.value && "border-primary",
										)}
									>
										<input
											id={inputId}
											type="radio"
											name="extract-strategy"
											checked={strategy === opt.value}
											onChange={() => setStrategy(opt.value)}
										/>
										<label
											htmlFor={inputId}
											className="font-medium flex-1 cursor-pointer"
										>
											{opt.label}
										</label>
										<StrategyInfoTooltip
											label={opt.label}
											description={opt.hint}
										/>
									</div>
								)
							})}
						</CardContent>
					</Card>

					<Card>
						<CardHeader className="p-2">3. Tag filters</CardHeader>
						<CardContent className="p-2">
							<ExtractTagFilterEditor
								state={tagFilterEditor}
								onChange={setTagFilterEditor}
							/>
						</CardContent>
					</Card>

					<Card>
						<CardHeader className="p-2">4. OSM PBF file</CardHeader>
						<CardContent className="p-2">
							<OsmPbfFileInput
								file={pendingFile}
								setFile={async (f) => {
									setPendingFile(f)
									return
								}}
								pbfOnly
								disabled={isExtracting}
							/>
						</CardContent>
					</Card>

					<Card>
						<CardContent className="p-2 flex flex-col gap-2">
							<Button
								type="button"
								size="lg"
								className="w-full"
								disabled={!canExtract}
								onClick={() => void runExtract()}
							>
								Extract
							</Button>
							<Button
								type="button"
								disabled={
									isExtracting ||
									!extract.osm ||
									!extract.osmInfo ||
									!canExtract
								}
								variant="secondary"
								className="w-full"
								onClick={() => void extract.downloadOsm()}
							>
								Download extracted PBF
							</Button>
						</CardContent>
					</Card>
				</div>
				<SidebarLog />
			</Sidebar>
			<MapContent>
				<Basemap initialViewState={initialViewState}>
					<ExtractMapSearch
						onBoundingPlace={(next) => {
							setBbox(next)
						}}
					/>
					<ExtractBboxLayer bbox={bbox} />
					<ExtractBboxCornerMarkers
						bbox={bbox}
						onCornerDrag={(corner, lng, lat) =>
							setBbox((prev) => bboxAfterCornerDrag(prev, corner, lng, lat))
						}
					/>
					{extract.osm ? (
						<>
							<OsmixRasterSource osmId={extract.osm.id} />
							<OsmixVectorOverlay osm={extract.osm} />
						</>
					) : null}
				</Basemap>
			</MapContent>
		</Main>
	)
}
