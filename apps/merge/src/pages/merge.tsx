import { Osm, type OsmChanges, writeOsmToPbfStream } from "@osmix/core"
import { atom, useAtom, useAtomValue, useSetAtom } from "jotai"
import {
	ArrowLeft,
	ArrowRightIcon,
	DownloadIcon,
	FastForwardIcon,
	FileDiff,
	Loader2Icon,
	MaximizeIcon,
	MergeIcon,
	SkipForwardIcon,
} from "lucide-react"
import { showSaveFilePicker } from "native-file-system-adapter"
import { useCallback, useMemo, useTransition } from "react"
import Basemap from "@/components/basemap"
import DeckGlOverlay from "@/components/deckgl-overlay"
import { Details, DetailsContent, DetailsSummary } from "@/components/details"
import EntityDetails from "@/components/entity-details"
import { Main, MapContent, Sidebar } from "@/components/layout"
import LogContent from "@/components/log"
import ChangesSummary, {
	ChangesExpandableList,
	ChangesFilters,
	ChangesPagination,
} from "@/components/osm-changes-summary"
import OsmInfoTable from "@/components/osm-info-table"
import OsmPbfFileInput from "@/components/osm-pbf-file-input"
import OsmixRasterSource from "@/components/osmix-raster-source"
import { Button } from "@/components/ui/button"
import {
	useFlyToEntity,
	useFlyToOsmBounds,
	usePickableOsmTileLayer,
	useSelectedEntityLayer,
} from "@/hooks/map"
import { useOsmFile } from "@/hooks/osm"
import { DEFAULT_BASE_PBF_URL, DEFAULT_PATCH_PBF_URL } from "@/settings"
import { changesAtom } from "@/state/changes"
import { Log } from "@/state/log"
import { selectedEntityAtom, selectOsmEntityAtom } from "@/state/osm"
import { osmWorker } from "@/state/worker"

const deckTooltipStyle: Partial<CSSStyleDeclaration> = {
	backgroundColor: "white",
	padding: "0",
	color: "var(--slate-950)",
}

const STEPS = [
	"select-osm-pbf-files",
	"review-changeset",
	"inspect-patch-osm",
	"review-changeset",
	"direct-merge",
	"review-changeset",
	"deduplicate-nodes",
	"review-changeset",
	"create-intersections",
	"review-changeset",
	"inspect-final-osm",
] as const

const stepIndexAtom = atom<number>(0)
const stepAtom = atom<(typeof STEPS)[number] | null>((get) => {
	const stepIndex = get(stepIndexAtom)
	return STEPS[stepIndex]
})

export default function Merge() {
	const base = useOsmFile("base", DEFAULT_BASE_PBF_URL)
	const patch = useOsmFile("patch", DEFAULT_PATCH_PBF_URL)
	const [isTransitioning, startTransition] = useTransition()
	const [changes, setChanges] = useAtom(changesAtom)
	const flyToEntity = useFlyToEntity()
	const flyToOsmBounds = useFlyToOsmBounds()
	const selectedEntity = useAtomValue(selectedEntityAtom)
	const selectEntity = useSetAtom(selectOsmEntityAtom)
	const baseTileLayer = usePickableOsmTileLayer(base.osm)
	const patchTileLayer = usePickableOsmTileLayer(patch.osm)
	const selectedEntityLayer = useSelectedEntityLayer()

	const [stepIndex, setStepIndex] = useAtom(stepIndexAtom)

	const prevStep = useCallback(() => {
		selectEntity(null, null)
		setStepIndex((s) => s - 1)
	}, [setStepIndex, selectEntity])
	const nextStep = useCallback(() => {
		selectEntity(null, null)
		setStepIndex((s) => s + 1)
	}, [setStepIndex, selectEntity])
	const goToStep = useCallback(
		(step: number | (typeof STEPS)[number]) => {
			const stepIndex = typeof step === "number" ? step : STEPS.indexOf(step)
			selectEntity(null, null)
			setStepIndex(stepIndex)
		},
		[setStepIndex, selectEntity],
	)

	const startStepTask = useCallback(
		(message: string, fn: () => Promise<string>) => {
			nextStep()
			const task = Log.startTask(message)
			startTransition(async () => {
				const endMessage = await fn()
				task.end(endMessage)
			})
		},
		[nextStep],
	)

	const downloadJsonChanges = useCallback(async () => {
		if (!changes) return
		startTransition(async () => {
			const task = Log.startTask("Converting changeset to JSON")
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
	}, [changes])

	const applyChanges = useCallback(async (changes: OsmChanges) => {
		const task = Log.startTask("Applying changes to OSM")

		const newOsm = Osm.from(
			await osmWorker.applyChangesAndReplace(changes.osmId),
		)
		task.end("Changes applied", "ready")
		return newOsm
	}, [])

	const hasZeroChanges = useMemo(() => {
		if (!changes) return true
		return (
			Object.keys(changes.nodes).length === 0 &&
			Object.keys(changes.ways).length === 0 &&
			Object.keys(changes.relations).length === 0
		)
	}, [changes])

	return (
		<Main>
			<Sidebar>
				<div className="flex flex-col p-4 gap-4">
					<Step step="select-osm-pbf-files" title="SELECT OSM PBF FILES">
						<div>
							Select two PBF files to merge. Note: entities from the patch file
							are prioritized over matching entities in the base file.
						</div>

						<div className="flex flex-col border-1">
							<div className="font-bold p-2">BASE OSM PBF</div>
							<OsmPbfFileInput
								file={base.file}
								setFile={async (file) => {
									const osm = await base.loadOsmFile(file)
									flyToOsmBounds(osm)
								}}
							/>
							<OsmInfoTable
								defaultOpen={false}
								osm={base.osm}
								file={base.file}
							/>
						</div>

						<div className="flex flex-col border-1">
							<div className="font-bold p-2">PATCH OSM PBF</div>
							<OsmPbfFileInput
								file={patch.file}
								setFile={async (file) => {
									const osm = await patch.loadOsmFile(file)
									flyToOsmBounds(osm)
								}}
							/>
							<OsmInfoTable
								defaultOpen={false}
								osm={patch.osm}
								file={patch.file}
							/>
						</div>
						<div className="flex flex-col gap-1">
							<div className="font-bold">CLEAN INPUT OSM</div>
							<p>
								Selected OSM PBFs will First be inspected for duplicate entities
								within each dataset. Later, we will search for duplicate
								entities between the two datasets.
							</p>
							<p>
								Duplicates are entities which either have the same ID or are
								geographically identical. A best effort is made to select which
								duplicate to keep. First, if there is a version number or
								modification date, that takes precendence. If that is not
								available, then the duplicate with the higher number of tags is
								kept.
							</p>
							<p>
								When a duplicate is found, a changeset is created with an entry
								to remove the duplicate entity. That changeset can be reviewed
								and applied on the next page.
							</p>
						</div>
						<Button
							disabled={isTransitioning || !base.osm || !patch.osm}
							onClick={() => {
								startStepTask(
									"Inspecting base OSM for duplicate entities",
									async () => {
										if (!base.osm) throw Error("Base OSM is not loaded")
										const baseChanges = await osmWorker.dedupeNodesAndWays(
											base.osm.id,
										)
										setChanges(baseChanges)
										return `Found ${baseChanges?.stats.deduplicatedNodes.toLocaleString()} duplicate nodes and ${baseChanges?.stats.deduplicatedWays.toLocaleString()} duplicate ways`
									},
								)
							}}
						>
							Inspect base OSM for duplicate entities
						</Button>
						<Button
							disabled={isTransitioning || !base.osm || !patch.osm}
							onClick={() => {
								goToStep("inspect-final-osm")
								const task = Log.startTask(
									"Running all merge steps, please wait...",
								)
								startTransition(async () => {
									if (!base.osm) throw Error("Base OSM is not loaded")
									if (!patch.osm) throw Error("Patch OSM is not loaded")
									task.update("Deduplicating nodes and ways in base OSM")
									await osmWorker.dedupeNodesAndWays(base.osm.id)
									await osmWorker.applyChangesAndReplace(base.osm.id)

									task.update("Deduplicating nodes and ways in patch OSM")
									await osmWorker.dedupeNodesAndWays(patch.osm.id)
									await osmWorker.applyChangesAndReplace(patch.osm.id)

									task.update(
										"Generating direct changes from patch OSM to base OSM",
									)
									await osmWorker.generateChangeset(
										base.osm.id,
										patch.osm.id,
										{
											directMerge: true,
											deduplicateNodes: false,
											createIntersections: false,
										},
										false,
									)
									await osmWorker.applyChangesAndReplace(base.osm.id)

									// TODO: add this step back when it is split from the direct merge
									// await osmWorker.generateChangeset(base.osm.id, patch.osm.id, {
									// 	directMerge: false,
									//	deduplicateNodes: true,
									//	createIntersections: false,
									// })
									// await osmWorker.applyChangesAndReplace(base.osm.id)

									task.update("Creating intersections in base OSM")
									await osmWorker.generateChangeset(
										base.osm.id,
										patch.osm.id,
										{
											directMerge: false,
											deduplicateNodes: false,
											createIntersections: true,
										},
										false,
									)
									await osmWorker.applyChangesAndReplace(base.osm.id)

									task.end("All merge steps completed")
								})
							}}
						>
							Run all merge steps{" "}
							{isTransitioning ? <Loader2Icon /> : <FastForwardIcon />}
						</Button>
					</Step>

					<Step step="inspect-patch-osm" title="INSPECT PATCH OSM">
						<div>
							Next step is to generate a changeset for the patch OSM PBF
							removing any duplicate entities.
						</div>

						<div className="flex flex-col border-1">
							<div className="font-bold p-2">PATCH OSM PBF</div>
							<OsmInfoTable
								defaultOpen={false}
								osm={patch.osm}
								file={patch.file}
							/>
						</div>
						<Button
							disabled={isTransitioning || !patch.osm}
							onClick={() => {
								startStepTask(
									"Inspecting patch OSM for duplicate entities",
									async () => {
										if (!patch.osm) throw Error("Patch OSM is not loaded")
										const patchChanges = await osmWorker.dedupeNodesAndWays(
											patch.osm.id,
										)
										setChanges(patchChanges)
										return `Found ${patchChanges?.stats.deduplicatedNodes.toLocaleString()} duplicate nodes and ${patchChanges?.stats.deduplicatedWays.toLocaleString()} duplicate ways`
									},
								)
							}}
						>
							Inspect patch OSM for duplicate entities
						</Button>
					</Step>

					<Step step="direct-merge" title="DIRECT MERGE">
						<div>
							Add all new entities from the patch onto the base data set.
							Overwrite any entities that have matching IDs.
						</div>

						<div className="flex flex-col border-1">
							<div className="flex flex-row justify-between items-center">
								<div className="font-bold p-2">BASE OSM PBF</div>
								{base.osm && <DownloadOsmButton osm={base.osm} />}
							</div>
							<OsmInfoTable
								defaultOpen={false}
								osm={base.osm}
								file={base.file}
							/>
						</div>
						<div className="flex flex-col border-1">
							<div className="flex flex-row justify-between items-center">
								<div className="font-bold p-2">PATCH OSM PBF</div>
								{patch.osm && <DownloadOsmButton osm={patch.osm} />}
							</div>
							<OsmInfoTable
								defaultOpen={false}
								osm={patch.osm}
								file={patch.file}
							/>
						</div>

						<div className="flex gap-2 justify-between">
							<Button
								className="flex-1/2"
								disabled={isTransitioning}
								variant="outline"
								onClick={prevStep}
							>
								<ArrowLeft /> Back
							</Button>
							<Button
								className="flex-1/2"
								disabled={isTransitioning}
								onClick={() => {
									startStepTask("Generating changeset", async () => {
										if (!base.osm || !patch.osm)
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
										return "Changeset generated"
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
						{changes && base.osm && (
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

						{changes == null || hasZeroChanges ? (
							<Button onClick={() => nextStep()} disabled={isTransitioning}>
								No changes, go to next step <ArrowRightIcon />
							</Button>
						) : (
							<Button
								disabled={isTransitioning}
								onClick={() => {
									startStepTask("Applying changes to OSM", async () => {
										if (!changes) throw Error("Changes are not loaded")
										const newOsm = await applyChanges(changes)
										if (changes.osmId === base.osm?.id) {
											base.setOsm(newOsm)
										} else if (changes.osmId === patch.osm?.id) {
											patch.setOsm(newOsm)
										} else {
											throw Error(
												"Changeset OSM ID does not match base or patch OSM ID",
											)
										}
										return "Changes applied"
									})
								}}
							>
								Apply changes <MergeIcon />
							</Button>
						)}
					</Step>

					<Step
						step="deduplicate-nodes"
						title="DE-DUPLICATE NODES"
						isTransitioning={isTransitioning}
					>
						<div>
							Search for geographically identical nodes between the two datasets
							and de-duplicate them. Replaces references in ways and relations.
						</div>

						<div className="flex flex-col border-1">
							<div className="flex flex-row justify-between">
								<div className="font-bold p-2">CURRENT OSM PBF</div>
								{base.osm && <DownloadOsmButton osm={base.osm} />}
							</div>
							<OsmInfoTable
								defaultOpen={false}
								osm={base.osm}
								file={base.file}
							/>
						</div>

						<div className="flex gap-2 justify-between">
							<Button
								className="flex-1/2"
								variant="outline"
								onClick={() => goToStep("inspect-final-osm")}
							>
								<SkipForwardIcon /> Skip
							</Button>
							<Button
								className="flex-1/2"
								onClick={() => {
									startStepTask("De-duplicating nodes and ways", async () => {
										if (!base.osm || !patch.osm)
											throw Error("Missing data to generate changes")
										const results = await osmWorker.dedupeNodesAndWays(
											base.osm.id,
										)
										setChanges(results)
										return "Changeset generated"
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
						<div className="flex flex-col gap-1">
							<p>
								Look for new ways that cross over existing ways and determine if
								they are candidates for creating intersection nodes by checking
								their tags.
							</p>
							<p>
								This process loops through all of the new ways and finds
								possible candidates via a fast search for existing ways that are
								geographically close. Only candidates with tags which allow the
								ways to intersect are considered. Intersection candidates must
								have a `highway` tag, be a line, have the same `layer` tag (if
								they have one), and not be a bridge or a tunnel.
							</p>
							<p>
								Next, we check each candidate way to find the real intersection
								point with the new way. If the ways intersect, we check for
								existing nodes at that point. If a node already exists, we
								re-use it, prioritizing nodes from the new dataset. If no nodes
								exist, we create a new node.
							</p>
							<p>
								Next, we modify the ways to ensure they have the selected
								intersection node in their refs list. These modifications and
								changes are then reviewable on the following page.
							</p>
						</div>

						<div className="flex gap-2 justify-between">
							<Button
								className="flex-1/2"
								variant="outline"
								onClick={() => goToStep("inspect-final-osm")}
							>
								<SkipForwardIcon /> Skip
							</Button>
							<Button
								className="flex-1/2"
								onClick={() => {
									startStepTask("Generating changeset", async () => {
										if (!base.osm || !patch.osm)
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
										return "Changeset generated"
									})
								}}
							>
								Create intersections <FileDiff />
							</Button>
						</div>
					</Step>

					<Step
						step="inspect-final-osm"
						title="INSPECT OSM"
						isTransitioning={isTransitioning}
					>
						<div>
							Changes have been applied and a new OSM dataset has been created.
							It can be inspected here and downloaded as a new PBF. Zoom in to
							select entities and see the changes.
						</div>

						{base.osm && (
							<>
								<div className="flex flex-col border-1">
									<div className="flex justify-between items-center">
										<div className="font-bold p-2">NEW OSM PBF</div>
										<DownloadOsmButton osm={base.osm} />
									</div>
									<OsmInfoTable
										defaultOpen={false}
										osm={base.osm}
										file={base.file}
									/>
								</div>

								{selectedEntity && (
									<div className="flex flex-col border-1">
										<div className="flex justify-between items-center">
											<div className="font-bold p-2">SELECTED ENTITY</div>
											<Button
												onClick={() => {
													if (!base.osm || !selectedEntity) return
													flyToEntity(base.osm, selectedEntity)
												}}
												variant="ghost"
												size="icon"
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

								<DownloadOsmButton osm={base.osm} size="lg" variant="default">
									Download merged OSM PBF
								</DownloadOsmButton>
							</>
						)}
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
										style: deckTooltipStyle,
										html: `<h3 className="p-2">node</h3>`,
									}
								}
								if (sourceLayerId.includes("ways")) {
									return {
										className: "deck-tooltip",
										style: deckTooltipStyle,
										html: `<h3 className="p-2">way</h3>`,
									}
								}
							}
							return null
						}}
					/>
					{base.osm && <OsmixRasterSource osmId={base.osm.id} />}
					{patch.osm && <OsmixRasterSource osmId={patch.osm.id} />}
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

function DownloadOsmButton({
	children,
	osm,
	...props
}: React.ComponentProps<typeof Button> & { osm: Osm }) {
	const [isTransitioning, startTransition] = useTransition()
	return (
		<Button
			disabled={isTransitioning}
			onClick={(e) => {
				e.preventDefault()
				startTransition(async () => {
					const task = Log.startTask("Generating OSM file to download", "info")
					const suggestedName = osm.id.endsWith(".pbf")
						? osm.id
						: `${osm.id}.pbf`
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
			}}
			size="icon"
			title="Download this OSM PBF"
			variant="ghost"
			{...props}
		>
			{isTransitioning ? (
				<Loader2Icon className="animate-spin size-4" />
			) : (
				<DownloadIcon />
			)}
			{children}
		</Button>
	)
}
