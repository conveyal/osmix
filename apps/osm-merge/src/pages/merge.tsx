import useStartTask from "@/hooks/log"
import {
	useBitmapTileLayer,
	usePickableOsmTileLayer,
	useSelectedEntityLayer,
} from "@/hooks/map"
import { useOsmFile, useOsmWorker } from "@/hooks/osm"
import { APPID, DEFAULT_BASE_PBF_URL, DEFAULT_PATCH_PBF_URL } from "@/settings"
import { mapAtom } from "@/state/map"
import { useAtomValue } from "jotai"
import {
	ArrowLeft,
	ArrowRight,
	DownloadIcon,
	FileDiff,
	Loader2Icon,
	MaximizeIcon,
	MergeIcon,
} from "lucide-react"
import { showSaveFilePicker } from "native-file-system-adapter"
import {
	Osm,
	writeOsmToPbfStream,
	type OsmChange,
	type OsmChanges,
	type OsmMergeOptions,
} from "osm.ts"
import { useCallback, useEffect, useRef, useState, useTransition } from "react"
import Basemap from "../components/basemap"
import DeckGlOverlay from "../components/deckgl-overlay"
import { Details, DetailsContent, DetailsSummary } from "../components/details"
import EntityDetails from "../components/entity-details"
import { Main, MapContent, Sidebar } from "../components/layout"
import OsmInfoTable from "../components/osm-info-table"
import OsmPbfFileInput from "../components/osm-pbf-file-input"
import { Button } from "../components/ui/button"

export default function Merge() {
	const [baseFile, setBaseFile] = useState<File | null>(null)
	const [patchFile, setPatchFile] = useState<File | null>(null)
	const {
		osm: baseOsm,
		setOsm: setBaseOsm,
		isLoading: baseOsmIsLoading,
	} = useOsmFile(baseFile, "base")
	const {
		osm: patchOsm,
		setOsm: setPatchOsm,
		isLoading: patchOsmIsLoading,
	} = useOsmFile(patchFile, "patch")
	const [mergedOsm, setMergedOsm] = useState<Osm | null>(null)
	const osmWorker = useOsmWorker()
	const [isTransitioning, startTransition] = useTransition()
	const [changes, setChanges] = useState<OsmChanges | null>(null)
	const startTask = useStartTask()
	const map = useAtomValue(mapAtom)

	const baseTileLayer = useBitmapTileLayer(baseOsm)
	const patchTileLayer = useBitmapTileLayer(patchOsm)
	const { layer: mergedTileLayer, selectedEntity: mergedSelectedEntity } =
		usePickableOsmTileLayer(mergedOsm)

	const selectedEntityLayer = useSelectedEntityLayer(mergedOsm)

	const [step, setStep] = useState<number>(1)

	const [mergeOptions, setMergeOptions] = useState<OsmMergeOptions>({
		directMerge: true,
		deduplicateNodes: true,
		createIntersections: true,
	})

	// Auto load default files for faster testing
	const isLoadingDefaultFilesRef = useRef(false)
	useEffect(() => {
		if (process.env.NODE_ENV !== "development") return
		if (!baseFile && !patchFile && !isLoadingDefaultFilesRef.current) {
			isLoadingDefaultFilesRef.current = true
			Promise.all([
				fetch(DEFAULT_BASE_PBF_URL)
					.then((res) => res.blob())
					.then((blob) => {
						setBaseFile(new File([blob], "yakima-full.osm.pbf"))
					}),
				fetch(DEFAULT_PATCH_PBF_URL)
					.then((res) => res.blob())
					.then((blob) => {
						setPatchFile(new File([blob], "yakima-osw.osm.pbf"))
					}),
			])
		}
	}, [baseFile, patchFile])

	const prevStep = useCallback(() => {
		setStep((s) => s - 1)
	}, [])
	const nextStep = useCallback(() => {
		setStep((s) => s + 1)
	}, [])

	const downloadOsm = useCallback(
		async (osm: Osm, name?: string) => {
			startTransition(async () => {
				const task = startTask("Generating OSM file to download", "info")
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
				task.end(`Created ${fileHandle.name} PBF for download`, "ready")
			})
		},
		[startTask],
	)

	return (
		<Main>
			<Sidebar>
				<div className="flex flex-col p-4 gap-4">
					<If t={step === 1}>
						<div>
							<div className="font-bold">1: SELECT OSM PBF FILES</div>
							<div>
								Select two PBF files to merge. Note: entities from the patch
								file are prioritized over matching entities in the base file.
							</div>
						</div>
						<hr />
						<div>
							<div className="font-bold">BASE OSM PBF</div>
							<OsmPbfFileInput
								file={baseFile}
								isLoading={baseOsmIsLoading}
								setFile={setBaseFile}
							/>
							<OsmInfoTable defaultOpen={false} osm={baseOsm} file={baseFile} />
						</div>
						<div>
							<div className="font-bold">PATCH OSM PBF</div>
							<OsmPbfFileInput
								file={patchFile}
								isLoading={patchOsmIsLoading}
								setFile={setPatchFile}
							/>
							<OsmInfoTable
								defaultOpen={false}
								osm={patchOsm}
								file={patchFile}
							/>
						</div>
						<Button disabled={!baseOsm || !patchOsm} onClick={nextStep}>
							<ArrowRight /> Select merge options
						</Button>
					</If>

					<If t={step === 2}>
						<div>
							<div className="font-bold">2: SELECT MERGE OPTIONS</div>
							<div>
								Select merge options before generating a changeset. Note:
								changeset generation can take some time.
							</div>
						</div>
						<hr />
						<div>
							<div className="font-bold">BASE OSM PBF</div>
							<OsmInfoTable defaultOpen={false} osm={baseOsm} file={baseFile} />
						</div>
						<div>
							<div className="font-bold">PATCH OSM PBF</div>
							<OsmInfoTable
								defaultOpen={false}
								osm={patchOsm}
								file={patchFile}
							/>
						</div>
						<div className="p-2 border border-slate-950 flex gap-2">
							<p>
								<b>DIRECT MERGE:</b> Add all new entities from the patch onto
								the base data set. Overwrite any entities that have matching
								IDs.
								<br />
								<span className="font-bold">Direct merge is required.</span>
							</p>
							<input
								type="checkbox"
								disabled={true}
								checked={mergeOptions.directMerge}
								onChange={(e) => {
									const simple = e.currentTarget.checked
									setMergeOptions((m) => ({
										...m,
										directMerge: simple,
									}))
								}}
							/>
						</div>
						<div className="p-2 border border-slate-950 flex gap-2">
							<p>
								<b>DE-DUPLICATE NODES:</b> Search for geographically identical
								nodes in the two datasets and deduplicate them. Replaces
								references in ways and relations.
							</p>
							<input
								type="checkbox"
								checked={mergeOptions.deduplicateNodes}
								onChange={(e) => {
									const deduplicateNodes = e.currentTarget.checked
									setMergeOptions((m) => ({
										...m,
										deduplicateNodes,
									}))
								}}
							/>
						</div>
						<div className="p-2 border border-slate-950 flex gap-2">
							<p>
								<b>ADD INTERSECTIONS:</b> Look for new ways that cross over
								existing ways and determine if they are candidates for creating
								intersection nodes by checking their tags.
							</p>
							<input
								type="checkbox"
								checked={mergeOptions.createIntersections}
								onChange={(e) => {
									const createIntersections = e.currentTarget.checked
									setMergeOptions((m) => ({
										...m,
										createIntersections,
									}))
								}}
							/>
						</div>

						<Button
							onClick={() => {
								nextStep()
								startTransition(async () => {
									if (!baseOsm || !patchOsm || !osmWorker)
										throw Error("Missing data to generate changes")
									const results = await osmWorker.generateChangeset(
										baseOsm.id,
										patchOsm.id,
										mergeOptions,
									)
									console.log(results)
									setChanges(results)
								})
							}}
						>
							<FileDiff />
							Generate changeset
						</Button>
						<Button variant="outline" onClick={prevStep}>
							<ArrowLeft /> Back
						</Button>
					</If>

					<If t={step === 3}>
						{isTransitioning || changes == null ? (
							<div className="flex items-center gap-1">
								<Loader2Icon className="animate-spin size-4" />
								<div className="font-bold">GENERATING CHANGESET</div>
							</div>
						) : (
							<>
								<div className="font-bold">3: REVIEW CHANGESET</div>
								<div>
									Changes have been generated and can be reviewed below. Once
									the review is complete you can apply changes to generate a new
									OSM file ready to be downloaded.
								</div>
							</>
						)}
						{changes && <ChangesSummary changes={changes} />}
						<Button
							disabled={changes == null || isTransitioning}
							onClick={() => {
								if (!osmWorker) throw Error("No OSM worker")
								nextStep()
								startTransition(async () => {
									if (!changes) throw Error("No changes to apply")
									if (!baseOsm) throw Error("No base OSM")
									const newOsm = await osmWorker.applyChanges(
										`merged-${baseOsm.id}`,
									)
									setBaseOsm(null)
									setPatchOsm(null)
									setMergedOsm(Osm.from(newOsm))
								})
							}}
						>
							<MergeIcon /> Apply changes
						</Button>
						<Button variant="outline" onClick={prevStep}>
							<ArrowLeft /> Back
						</Button>
					</If>

					<If t={step === 4}>
						{mergedOsm == null ? (
							<div className="flex items-center gap-1">
								<Loader2Icon className="animate-spin size-4" />
								<div className="font-bold">APPLYING CHANGES</div>
							</div>
						) : (
							<>
								<div className="font-bold">4: INSPECT OSM</div>
								<div>
									Changes have been applied and a new OSM dataset has been
									created. It can be inspected here and downloaded as a new PBF.
									Zoom in to select entities and see the changes.
								</div>
								<hr />
								{mergedSelectedEntity && (
									<div>
										<div className="px-1 flex justify-between">
											<div className="font-bold">SELECTED ENTITY</div>
											<Button
												onClick={() => {
													const bbox =
														mergedOsm?.getEntityBbox(mergedSelectedEntity)
													if (bbox)
														map?.fitBounds(bbox, {
															padding: 100,
															maxDuration: 0,
														})
												}}
												variant="ghost"
												size="icon"
												className="size-4"
												title="Fit bounds to entity"
											>
												<MaximizeIcon />
											</Button>
										</div>
										<EntityDetails
											entity={mergedSelectedEntity}
											open={true}
											osm={mergedOsm}
										/>
									</div>
								)}
								<Button
									onClick={() => downloadOsm(mergedOsm)}
									disabled={isTransitioning}
								>
									{isTransitioning ? (
										<>
											<Loader2Icon className="animate-spin size-4" /> Creating
											PBF...
										</>
									) : (
										<>
											<DownloadIcon /> Download merged OSM PBF
										</>
									)}
								</Button>
							</>
						)}
					</If>
				</div>
			</Sidebar>
			<MapContent>
				<Basemap>
					<DeckGlOverlay
						layers={[
							baseTileLayer,
							patchTileLayer,
							mergedTileLayer,
							selectedEntityLayer,
						]}
						getTooltip={(pickingInfo) => {
							const sourceLayerId = pickingInfo.sourceLayer?.id
							if (sourceLayerId?.startsWith(`${APPID}:${mergedOsm?.id}`)) {
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
				</Basemap>
			</MapContent>
		</Main>
	)
}

function If({ children, t }: { children: React.ReactNode; t: boolean }) {
	if (!t) return null
	return <>{children}</>
}

function ChangesSummary({ changes }: { changes: OsmChanges }) {
	const [currentPage, setCurrentPage] = useState(0)
	const changesPerPage = 10

	// Get all changes for pagination
	const allChanges: Array<OsmChange & { type: "node" | "way" | "relation" }> = [
		...Object.values(changes.nodes).map((change) => ({
			...change,
			type: "node" as const,
		})),
		...Object.values(changes.ways).map((change) => ({
			...change,
			type: "way" as const,
		})),
		...Object.values(changes.relations).map((change) => ({
			...change,
			type: "relation" as const,
		})),
	]

	const totalPages = Math.ceil(allChanges.length / changesPerPage)
	const startIndex = currentPage * changesPerPage
	const endIndex = startIndex + changesPerPage
	const currentChanges = allChanges.slice(startIndex, endIndex)

	const goToNextPage = () => {
		if (currentPage < totalPages - 1) {
			setCurrentPage(currentPage + 1)
		}
	}

	const goToPrevPage = () => {
		if (currentPage > 0) {
			setCurrentPage(currentPage - 1)
		}
	}

	const nodeChanges = Object.keys(changes.nodes).length
	const wayChanges = Object.keys(changes.ways).length
	const relationChanges = Object.keys(changes.relations).length
	const totalChanges = nodeChanges + wayChanges + relationChanges

	return (
		<div className="flex flex-col gap-2">
			<Details open={true}>
				<DetailsSummary>CHANGES SUMMARY</DetailsSummary>
				<DetailsContent>
					<table>
						<tbody>
							<tr>
								<td>node changes</td>
								<td>{nodeChanges.toLocaleString()}</td>
							</tr>
							<tr>
								<td>way changes</td>
								<td>{wayChanges.toLocaleString()}</td>
							</tr>
							<tr>
								<td>relation changes</td>
								<td>{relationChanges.toLocaleString()}</td>
							</tr>
							<tr>
								<td>total changes</td>
								<td>{totalChanges.toLocaleString()}</td>
							</tr>
							<tr>
								<td>deduplicated nodes</td>
								<td>{changes.stats.deduplicatedNodes.toLocaleString()}</td>
							</tr>
							<tr>
								<td>deduplicated nodes replaced</td>
								<td>
									{changes.stats.deduplicatedNodesReplaced.toLocaleString()}
								</td>
							</tr>
							<tr>
								<td>intersection points found</td>
								<td>
									{changes.stats.intersectionPointsFound.toLocaleString()}
								</td>
							</tr>
						</tbody>
					</table>
				</DetailsContent>
			</Details>

			{/* Changes List */}
			<Details>
				<DetailsSummary>CHANGES PREVIEW</DetailsSummary>
				<DetailsContent>
					<div className="max-h-64 overflow-y-auto flex flex-col gap-2">
						{currentChanges.map((change, i) => (
							<ChangePreview
								key={`${change.type}-${change.entity.id}`}
								change={change}
								entityType={change.type}
								count={i + 1}
							/>
						))}
					</div>
					{totalPages > 1 && (
						<div className="flex items-center justify-between">
							<Button
								variant="ghost"
								size="sm"
								onClick={goToPrevPage}
								disabled={currentPage === 0}
							>
								<ArrowLeft className="w-3 h-3 mr-1" />
							</Button>
							<span className="text-xs text-slate-500">
								{currentPage + 1} of {totalPages}
							</span>
							<Button
								variant="ghost"
								size="sm"
								onClick={goToNextPage}
								disabled={currentPage === totalPages - 1}
							>
								<ArrowRight className="w-3 h-3 ml-1" />
							</Button>
						</div>
					)}
				</DetailsContent>
			</Details>
		</div>
	)
}

function ChangePreview({
	count,
	change,
	entityType,
}: {
	count: number
	change: OsmChange
	entityType: string
}) {
	const { changeType, entity } = change
	const changeTypeColor = {
		create: "text-green-600",
		modify: "text-yellow-600",
		delete: "text-red-600",
	}[changeType]

	return (
		<div key={`${entityType}-${entity.id}`} className="flex flex-col">
			<div className={`border-l pl-2 font-bold ${changeTypeColor}`}>
				{count}. {changeType.toUpperCase()}
			</div>
			<EntityDetails entity={entity} open={false} />
		</div>
	)
}
