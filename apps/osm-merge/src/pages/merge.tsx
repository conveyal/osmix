import { Details, DetailsContent, DetailsSummary } from "@/components/details"
import LogContent from "@/components/log"
import ChangesSummary, {
	ChangesExpandableList,
	ChangesFilters,
	ChangesPagination,
} from "@/components/osm-changes-summary"
import useStartTaskLog from "@/hooks/log"
import { usePickableOsmTileLayer, useSelectedEntityLayer } from "@/hooks/map"
import { useOsmFile } from "@/hooks/osm"
import { useSubscribeOsmWorkerToLog } from "@/hooks/log"
import { DEFAULT_BASE_PBF_URL, DEFAULT_PATCH_PBF_URL } from "@/settings"
import { changesAtom } from "@/state/changes"
import { mapAtom } from "@/state/map"
import { selectedEntityAtom } from "@/state/osm"
import { atom, useAtom, useAtomValue } from "jotai"
import {
	ArrowLeft,
	ArrowRight,
	DownloadIcon,
	FileDiff,
	Loader2Icon,
	MaximizeIcon,
	MergeIcon,
	SkipForwardIcon,
} from "lucide-react"
import { showSaveFilePicker } from "native-file-system-adapter"
import { Osm, writeOsmToPbfStream } from "osm.ts"
import { useCallback, useEffect, useRef, useTransition } from "react"
import Basemap from "../components/basemap"
import DeckGlOverlay from "../components/deckgl-overlay"
import EntityDetails from "../components/entity-details"
import { Main, MapContent, Sidebar } from "../components/layout"
import OsmInfoTable from "../components/osm-info-table"
import OsmPbfFileInput from "../components/osm-pbf-file-input"
import { Button } from "../components/ui/button"
import { osmWorker } from "@/state/worker"

const STEPS = [
	"select-osm-pbf-files",
	"direct-merge",
	"review-changeset",
	"deduplicate-nodes",
	"review-changeset",
	"create-intersections",
	"review-changeset",
	"inspect-osm",
] as const

const stepIndexAtom = atom<number>(0)
const stepAtom = atom<(typeof STEPS)[number] | null>((get) => {
	const stepIndex = get(stepIndexAtom)
	return STEPS[stepIndex]
})

export default function Merge() {
	const base = useOsmFile("base")
	const patch = useOsmFile("patch")
	const [isTransitioning, startTransition] = useTransition()
	const [changes, setChanges] = useAtom(changesAtom)
	const startTask = useStartTaskLog()
	const map = useAtomValue(mapAtom)

	const selectedEntity = useAtomValue(selectedEntityAtom)
	const baseTileLayer = usePickableOsmTileLayer(base.osm)
	const patchTileLayer = usePickableOsmTileLayer(patch.osm)
	const selectedEntityLayer = useSelectedEntityLayer()

	const [stepIndex, setStepIndex] = useAtom(stepIndexAtom)

	// Auto load default files for faster testing
	const isLoadingDefaultFilesRef = useRef(false)
	useEffect(() => {
		if (process.env.NODE_ENV !== "development") return
		if (!base.file && !patch.file && !isLoadingDefaultFilesRef.current) {
			isLoadingDefaultFilesRef.current = true
			Promise.all([
				fetch(DEFAULT_BASE_PBF_URL)
					.then((res) => res.blob())
					.then((blob) => {
						base.setFile(new File([blob], DEFAULT_BASE_PBF_URL))
					}),
				fetch(DEFAULT_PATCH_PBF_URL)
					.then((res) => res.blob())
					.then((blob) => {
						patch.setFile(new File([blob], DEFAULT_PATCH_PBF_URL))
					}),
			])
		}
	}, [base.file, patch.file, base.setFile, patch.setFile])

	const prevStep = useCallback(() => {
		setStepIndex((s) => s - 1)
	}, [setStepIndex])
	const nextStep = useCallback(() => {
		setStepIndex((s) => s + 1)
	}, [setStepIndex])
	const goToStep = useCallback(
		(step: number | (typeof STEPS)[number]) => {
			const stepIndex = typeof step === "number" ? step : STEPS.indexOf(step)
			setStepIndex(stepIndex)
		},
		[setStepIndex],
	)

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

	const downloadJsonChanges = useCallback(async () => {
		if (!changes) return
		startTransition(async () => {
			const task = startTask("Converting changeset to JSON", "info")
			const json = JSON.stringify(changes, null, 2)
			const fileHandle = await showSaveFilePicker({
				suggestedName: "osm-changes.json",
			})
			if (!fileHandle) return
			const stream = await fileHandle.createWritable()
			await stream.write(json)
			stream.close()
			task.end("Changeset converted to JSON", "ready")
		})
	}, [changes, startTask])

	const applyChanges = useCallback(async () => {
		const task = startTask("Applying changes to OSM", "info")
		startTransition(async () => {
			if (!changes) throw Error("No changes to apply")
			if (!base.osm) throw Error("No base OSM")
			const newOsm = await osmWorker.applyChangesAndReplace(base.osm.id)
			base.setOsm(Osm.from(newOsm))
			task.end("Changes applied", "ready")
		})
	}, [changes, base.osm, base.setOsm, startTask])

	return (
		<Main>
			<Sidebar>
				<div className="flex flex-col p-4 gap-4">
					<Step step="select-osm-pbf-files" title="SELECT OSM PBF FILES">
						<div>
							Select two PBF files to merge. Note: entities from the patch file
							are prioritized over matching entities in the base file.
						</div>
						<hr />
						<div>
							<div className="font-bold">BASE OSM PBF</div>
							<OsmPbfFileInput
								file={base.file}
								isLoading={base.isLoading}
								setFile={base.setFile}
							/>
							<OsmInfoTable
								defaultOpen={false}
								osm={base.osm}
								file={base.file}
							/>
						</div>
						<div>
							<div className="font-bold">PATCH OSM PBF</div>
							<OsmPbfFileInput
								file={patch.file}
								isLoading={patch.isLoading}
								setFile={patch.setFile}
							/>
							<OsmInfoTable
								defaultOpen={false}
								osm={patch.osm}
								file={patch.file}
							/>
						</div>
						<Button disabled={!base.osm || !patch.osm} onClick={nextStep}>
							Select merge options <ArrowRight />
						</Button>
					</Step>

					<Step step="direct-merge" title="DIRECT MERGE">
						<div>
							Add all new entities from the patch onto the base data set.
							Overwrite any entities that have matching IDs.
							<br />
							<span className="font-bold">Direct merge is required.</span>
						</div>
						<hr />
						<div>
							<div className="font-bold">BASE OSM PBF</div>
							<OsmInfoTable
								defaultOpen={false}
								osm={base.osm}
								file={base.file}
							/>
						</div>
						<div>
							<div className="font-bold">PATCH OSM PBF</div>
							<OsmInfoTable
								defaultOpen={false}
								osm={patch.osm}
								file={patch.file}
							/>
						</div>

						<div className="flex gap-2 justify-between">
							<Button className="flex-1/2" variant="outline" onClick={prevStep}>
								<ArrowLeft /> Back
							</Button>
							<Button
								className="flex-1/2"
								onClick={() => {
									nextStep()
									const task = startTask("Generating changeset", "info")
									startTransition(async () => {
										if (!base.osm || !patch.osm || !osmWorker)
											throw Error("Missing data to generate changes")
										const results = await osmWorker.generateChangeset(
											base.osm.id,
											patch.osm.id,
											{
												directMerge: true,
												deduplicateNodes: false,
												createIntersections: false,
											},
										)
										setChanges(results)
										task.end("Changeset generated", "ready")
									})
								}}
							>
								Generate direct changes <FileDiff />
							</Button>
						</div>
					</Step>

					<Step
						step="review-changeset"
						title="REVIEW CHANGESET"
						isTransitioning={isTransitioning}
					>
						<div>
							Changes have been generated from the previous step and can be
							reviewed below. Once the review is complete you can apply changes
							to the base OSM and move to the next step.
						</div>
						<div className="flex gap-2">
							<Button
								className="flex-1/2"
								disabled={isTransitioning}
								onClick={() => {
									downloadJsonChanges()
								}}
							>
								<DownloadIcon /> Download JSON changes
							</Button>
							<Button className="flex-1/2" disabled>
								<DownloadIcon /> Download .osc changes
							</Button>
						</div>
						{changes && (
							<ChangesSummary>
								{/* Changes List */}
								<Details>
									<DetailsSummary>CHANGES</DetailsSummary>
									<DetailsContent>
										<ChangesFilters />
										<ChangesExpandableList />
										<ChangesPagination />
									</DetailsContent>
								</Details>
							</ChangesSummary>
						)}

						<div className="flex gap-2 justify-between">
							<Button
								className="flex-1/2"
								disabled={changes == null || isTransitioning}
								onClick={() => {
									if (!osmWorker) throw Error("No OSM worker")
									nextStep()
									applyChanges()
								}}
							>
								Apply changes <MergeIcon />
							</Button>
						</div>
					</Step>

					<Step
						step="deduplicate-nodes"
						title="DE-DUPLICATE NODES"
						isTransitioning={isTransitioning}
					>
						<div>
							Search for geographically identical nodes in the two datasets and
							de-duplicate them. Replaces references in ways and relations.
						</div>

						<div className="flex gap-2 justify-between">
							<Button
								className="flex-1/2"
								variant="outline"
								onClick={() => goToStep("inspect-osm")}
							>
								<SkipForwardIcon /> Skip
							</Button>
							<Button
								className="flex-1/2"
								onClick={() => {
									nextStep()
									const task = startTask("Generating changeset", "info")
									startTransition(async () => {
										if (!base.osm || !patch.osm || !osmWorker)
											throw Error("Missing data to generate changes")
										const results = await osmWorker.generateChangeset(
											base.osm.id,
											patch.osm.id,
											{
												directMerge: false,
												deduplicateNodes: true,
												createIntersections: false,
											},
										)
										setChanges(results)
										task.end("Changeset generated", "ready")
									})
								}}
							>
								De-duplicate nodes <FileDiff />
							</Button>
						</div>
					</Step>

					<Step
						step="create-intersections"
						title="CREATE INTERSECTIONS"
						isTransitioning={isTransitioning}
					>
						<div>
							Look for new ways that cross over existing ways and determine if
							they are candidates for creating intersection nodes by checking
							their tags.
						</div>

						<div className="flex gap-2 justify-between">
							<Button
								className="flex-1/2"
								variant="outline"
								onClick={() => goToStep("inspect-osm")}
							>
								<SkipForwardIcon /> Skip
							</Button>
							<Button
								className="flex-1/2"
								onClick={() => {
									const task = startTask("Generating changeset", "info")
									nextStep()
									startTransition(async () => {
										if (!base.osm || !patch.osm || !osmWorker)
											throw Error("Missing data to generate changes")
										const results = await osmWorker.generateChangeset(
											base.osm.id,
											patch.osm.id,
											{
												directMerge: false,
												deduplicateNodes: false,
												createIntersections: true,
											},
										)
										setChanges(results)
										task.end("Changeset generated", "ready")
									})
								}}
							>
								Create intersections <FileDiff />
							</Button>
						</div>
					</Step>

					<Step
						step="inspect-osm"
						title="INSPECT OSM"
						isTransitioning={isTransitioning}
					>
						<div>
							Changes have been applied and a new OSM dataset has been created.
							It can be inspected here and downloaded as a new PBF. Zoom in to
							select entities and see the changes.
						</div>
						<hr />
						{base.osm && selectedEntity && (
							<div>
								<div className="px-1 flex justify-between">
									<div className="font-bold">SELECTED ENTITY</div>
									<Button
										onClick={() => {
											if (!base.osm || !selectedEntity) return
											const bbox = base.osm?.getEntityBbox(selectedEntity)
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
									entity={selectedEntity}
									open={true}
									osm={base.osm}
								/>
							</div>
						)}
						<Button
							onClick={() => {
								if (!base.osm) return // TODO shouldn't be necessary but TypeScript cries
								downloadOsm(base.osm)
							}}
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
					</Step>
				</div>
			</Sidebar>
			<MapContent>
				<Basemap>
					<DeckGlOverlay
						layers={[
							baseTileLayer,
							stepIndex > 0 ? null : patchTileLayer,
							selectedEntityLayer,
						]}
						getTooltip={(pickingInfo) => {
							const sourceLayerId = pickingInfo.sourceLayer?.id
							if (
								baseTileLayer &&
								sourceLayerId?.startsWith(baseTileLayer.id)
							) {
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

function Step({
	step,
	title,
	isTransitioning,
	children,
}: {
	step: (typeof STEPS)[number]
	title: string
	isTransitioning?: boolean
	children: React.ReactNode
}) {
	const currentStep = useAtomValue(stepAtom)
	const stepIndex = useAtomValue(stepIndexAtom)
	if (step !== currentStep) return null
	if (isTransitioning === true)
		return (
			<div className="flex flex-col gap-2">
				<div className="flex items-center gap-1">
					<Loader2Icon className="animate-spin size-4" />
					<div className="font-bold">PLEASE WAIT...</div>
				</div>
				<div className="h-48 p-2 border inset-shadow-xs">
					<LogContent />
				</div>
			</div>
		)
	return (
		<>
			<div className="font-bold">
				{stepIndex + 1}: {title}
			</div>
			{children}
		</>
	)
}

function If({ children, t }: { children: React.ReactNode; t: boolean }) {
	if (!t) return null
	return <>{children}</>
}
