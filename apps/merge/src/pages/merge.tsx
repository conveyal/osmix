import { Osmix } from "@osmix/core"
import { atom, useAtom, useAtomValue, useSetAtom } from "jotai"
import {
	ArrowLeft,
	ArrowRightIcon,
	DownloadIcon,
	FastForwardIcon,
	FileDiff,
	MaximizeIcon,
	MergeIcon,
	SkipForwardIcon,
} from "lucide-react"
import { showSaveFilePicker } from "native-file-system-adapter"
import { useMemo } from "react"
import ActionButton from "@/components/action-button"
import Basemap from "@/components/basemap"
import CustomControl from "@/components/custom-control"
import DeckGlOverlay from "@/components/deckgl-overlay"
import { Details, DetailsContent, DetailsSummary } from "@/components/details"
import EntityDetails from "@/components/entity-details"
import { Main, MapContent, Sidebar } from "@/components/layout"
import NominatimSearchControl from "@/components/nominatim-search-control"
import ChangesSummary, {
	ChangesExpandableList,
	ChangesFilters,
	ChangesPagination,
} from "@/components/osm-changes-summary"
import OsmInfoTable from "@/components/osm-info-table"
import OsmPbfFileInput from "@/components/osm-pbf-file-input"
import OsmixRasterSource from "@/components/osmix-raster-source"
import SidebarLog from "@/components/sidebar-log"
import { Button } from "@/components/ui/button"
import { ButtonGroup, ButtonGroupSeparator } from "@/components/ui/button-group"
import {
	Card,
	CardContent,
	CardFooter,
	CardHeader,
	CardTitle,
} from "@/components/ui/card"
import { Spinner } from "@/components/ui/spinner"
import {
	useFlyToEntity,
	useFlyToOsmBounds,
	usePickableOsmTileLayer,
	useSelectedEntityLayer,
} from "@/hooks/map"
import { useOsmFile } from "@/hooks/osm"
import { DEFAULT_BASE_PBF_URL, DEFAULT_PATCH_PBF_URL } from "@/settings"
import { changesetStatsAtom } from "@/state/changes"
import { Log } from "@/state/log"
import { selectedEntityAtom, selectOsmEntityAtom } from "@/state/osm"
import { osmWorker } from "@/state/worker"
import { changeStatsSummary } from "@/utils"

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
	const [changesetStats, setChangesetStats] = useAtom(changesetStatsAtom)
	const flyToEntity = useFlyToEntity()
	const flyToOsmBounds = useFlyToOsmBounds()
	const selectedEntity = useAtomValue(selectedEntityAtom)
	const selectEntity = useSetAtom(selectOsmEntityAtom)
	const baseTileLayer = usePickableOsmTileLayer(base.osm)
	const patchTileLayer = usePickableOsmTileLayer(patch.osm)
	const selectedEntityLayer = useSelectedEntityLayer()

	const [stepIndex, setStepIndex] = useAtom(stepIndexAtom)

	const prevStep = () => {
		selectEntity(null, null)
		setStepIndex((s) => s - 1)
	}
	const nextStep = () => {
		selectEntity(null, null)
		setStepIndex((s) => s + 1)
	}
	const goToStep = (step: number | (typeof STEPS)[number]) => {
		const stepIndex = typeof step === "number" ? step : STEPS.indexOf(step)
		selectEntity(null, null)
		setStepIndex(stepIndex)
	}
	const startStepTask = async (message: string, fn: () => Promise<string>) => {
		const task = Log.startTask(message)
		const endMessage = await fn()
		task.end(endMessage)
		nextStep()
	}

	const downloadJsonChanges = async () => {
		if (!changesetStats) return
		const fileHandle = await showSaveFilePicker({
			suggestedName: "osm-changes.json",
		})
		if (!fileHandle) return
		const stream = await fileHandle.createWritable()

		const PAGE_SIZE = 100_000
		const task = Log.startTask(
			`Converting ${changesetStats.totalChanges} changes to JSON`,
		)
		let page = 0
		let changesetPage: Awaited<ReturnType<typeof osmWorker.getChangesetPage>>
		do {
			changesetPage = await osmWorker.getChangesetPage(
				changesetStats.osmId,
				page++,
				PAGE_SIZE,
			)
			const json = JSON.stringify(changesetPage.changes, null, 2)
			await stream.write(json)
		} while (changesetPage.changes && changesetPage.changes.length > 0)
		stream.close()
		task.end("Changeset converted to JSON")
	}

	const applyChanges = async () => {
		if (!changesetStats) throw Error("Changeset stats are not loaded")
		const osm = Osmix.from(
			await osmWorker.applyChangesAndReplace(changesetStats.osmId),
		)
		setChangesetStats(null)
		return osm
	}

	const hasZeroChanges = useMemo(() => {
		if (!changesetStats) return true
		return changesetStats.totalChanges === 0
	}, [changesetStats])

	return (
		<Main>
			<Sidebar>
				<div className="flex flex-1 flex-col gap-4 overflow-y-auto p-4">
					<Step step="select-osm-pbf-files" title="SELECT OSM PBF FILES">
						<p>
							Select two PBF files to merge. Note: entities from the patch file
							are prioritized over matching entities in the base file.
						</p>

						<div className="flex flex-col border rounded shadow">
							<div className="font-bold p-2">BASE OSM PBF</div>
							<OsmPbfFileInput
								testId="merge-base-file"
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

						<div className="flex flex-col border rounded shadow">
							<div className="font-bold p-2">PATCH OSM PBF</div>
							<OsmPbfFileInput
								testId="merge-patch-file"
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
						<Card>
							<CardHeader>
								<CardTitle>CLEAN INPUT OSM</CardTitle>
							</CardHeader>
							<CardContent className="space-y-2">
								<p>
									Each file is first scanned for duplicate entities inside the
									same dataset. We then look for duplicates that appear in both
									files.
								</p>
								<p>
									Duplicates are features that share an ID or occupy the same
									geometry. We prefer entities with newer version metadata; if
									that information is missing we keep the feature with more
									tags.
								</p>
								<p>
									When a duplicate is detected we draft a changeset entry that
									removes the extra copy. Review those proposals in the next
									step before applying them.
								</p>
							</CardContent>
							<CardFooter>
								<ActionButton
									className="flex-1"
									disabled={!base.osm || !patch.osm}
									onAction={() =>
										startStepTask(
											"Inspecting base OSM for duplicate entities",
											async () => {
												if (!base.osm) throw Error("Base OSM is not loaded")
												const baseChanges = await osmWorker.dedupeNodesAndWays(
													base.osm.id,
												)
												setChangesetStats(baseChanges)
												return changeStatsSummary(baseChanges)
											},
										)
									}
								>
									Clean base OSM
								</ActionButton>
							</CardFooter>
						</Card>
						<Card>
							<CardHeader>
								<CardTitle>RUN ALL MERGE STEPS</CardTitle>
							</CardHeader>
							<CardContent className="space-y-2 leading-relaxed">
								<p>Run all merge steps without stopping for verification.</p>
								<ol className="list-decimal list-inside">
									<li>Deduplicate nodes and ways in base OSM</li>
									<li>Deduplicate nodes and ways in patch OSM</li>
									<li>Generate direct changes from patch OSM to base OSM</li>
									<li>De-duplicated nodes and ways in merged OSM</li>
									<li>
										Create new intersections in merged data where ways cross
									</li>
								</ol>
							</CardContent>
							<CardFooter>
								<ActionButton
									className="flex-1"
									disabled={!base.osm || !patch.osm}
									icon={<FastForwardIcon />}
									onAction={async () => {
										const task = Log.startTask(
											"Running all merge steps, please wait...",
										)
										if (!base.osm) throw Error("Base OSM is not loaded")
										if (!patch.osm) throw Error("Patch OSM is not loaded")

										task.update("Deduplicating nodes and ways in base OSM")
										const baseChanges = await osmWorker.dedupeNodesAndWays(
											base.osm.id,
										)
										setChangesetStats(baseChanges)
										task.update(changeStatsSummary(baseChanges))
										await osmWorker.applyChangesAndReplace(base.osm.id)

										task.update("Deduplicating nodes and ways in patch OSM")
										const patchChanges = await osmWorker.dedupeNodesAndWays(
											patch.osm.id,
										)
										setChangesetStats(patchChanges)
										task.update(changeStatsSummary(patchChanges))
										await osmWorker.applyChangesAndReplace(patch.osm.id)

										task.update(
											"Generating direct changes from patch OSM to base OSM",
										)
										const directChanges = await osmWorker.generateChangeset(
											base.osm.id,
											patch.osm.id,
											{
												directMerge: true,
												deduplicateNodes: false,
												createIntersections: false,
											},
										)
										setChangesetStats(directChanges)
										task.update(changeStatsSummary(directChanges))
										await osmWorker.applyChangesAndReplace(base.osm.id)

										// TODO: add this step back when it is split from the direct merge
										// await osmWorker.generateChangeset(base.osm.id, patch.osm.id, {
										// 	directMerge: false,
										//	deduplicateNodes: true,
										//	createIntersections: false,
										// })
										// await osmWorker.applyChangesAndReplace(base.osm.id)

										task.update("Creating intersections in base OSM")
										const intersectionsChanges =
											await osmWorker.generateChangeset(
												base.osm.id,
												patch.osm.id,
												{
													directMerge: false,
													deduplicateNodes: false,
													createIntersections: true,
												},
											)
										setChangesetStats(intersectionsChanges)
										task.update(changeStatsSummary(intersectionsChanges))
										const osm = Osmix.from(
											await osmWorker.applyChangesAndReplace(base.osm.id),
										)
										setChangesetStats(null)
										base.setOsm(osm)

										task.end("All merge steps completed")
										goToStep("inspect-final-osm")
									}}
								>
									Run all merge steps
								</ActionButton>
							</CardFooter>
						</Card>
					</Step>

					<Step step="inspect-patch-osm" title="INSPECT PATCH OSM">
						<p>
							Generate a changeset that removes duplicate entities from the
							patch file before it is merged into the base data.
						</p>

						<div className="flex flex-col border-1">
							<div className="font-bold p-2">PATCH OSM PBF</div>
							<OsmInfoTable
								defaultOpen={false}
								osm={patch.osm}
								file={patch.file}
							/>
						</div>
						<ActionButton
							disabled={!patch.osm}
							onAction={() =>
								startStepTask(
									"Inspecting patch OSM for duplicate entities",
									async () => {
										if (!patch.osm) throw Error("Patch OSM is not loaded")
										const patchChanges = await osmWorker.dedupeNodesAndWays(
											patch.osm.id,
										)
										setChangesetStats(patchChanges)
										return changeStatsSummary(patchChanges)
									},
								)
							}
						>
							Clean patch OSM
						</ActionButton>
					</Step>

					<Step step="direct-merge" title="DIRECT MERGE">
						<p>
							Add the patch entities to the base dataset and replace any base
							features that share the same IDs.
						</p>

						<div className="flex flex-col border-1">
							<div className="flex flex-row justify-between items-center">
								<div className="font-bold p-2">BASE OSM PBF</div>
								{base.osm && (
									<ActionButton
										icon={<DownloadIcon />}
										onAction={base.downloadOsm}
									/>
								)}
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
								{patch.osm && (
									<ActionButton
										icon={<DownloadIcon />}
										onAction={patch.downloadOsm}
									/>
								)}
							</div>
							<OsmInfoTable
								defaultOpen={false}
								osm={patch.osm}
								file={patch.file}
							/>
						</div>

						<ButtonGroup className="w-full">
							<ActionButton
								className="flex-1"
								onAction={async () => prevStep()}
								icon={<ArrowLeft />}
							>
								Back
							</ActionButton>
							<ButtonGroupSeparator />
							<ActionButton
								className="flex-1"
								icon={<FileDiff />}
								onAction={() =>
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
										setChangesetStats(results)
										return changeStatsSummary(results)
									})
								}
							>
								Generate direct changes
							</ActionButton>
						</ButtonGroup>
					</Step>

					<Step step="review-changeset" title="REVIEW CHANGESET">
						<p>
							Review the proposed edits produced in the previous step. Apply the
							changes to update the base OSM before moving forward.
						</p>
						<ButtonGroup className="w-full">
							<ActionButton
								className="flex-1"
								icon={<DownloadIcon />}
								onAction={downloadJsonChanges}
							>
								Download JSON changes
							</ActionButton>
							<ButtonGroupSeparator />
							<ActionButton
								className="flex-1"
								disabled
								icon={<DownloadIcon />}
								onAction={async () => {}}
							>
								Download .osc changes
							</ActionButton>
						</ButtonGroup>
						{changesetStats && base.osm && (
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

						{changesetStats == null || hasZeroChanges ? (
							<ActionButton
								onAction={async () => nextStep()}
								icon={<ArrowRightIcon />}
							>
								No changes, go to next step
							</ActionButton>
						) : (
							<ActionButton
								icon={<MergeIcon />}
								onAction={() =>
									startStepTask("Applying changes to OSM", async () => {
										if (!changesetStats) throw Error("Changes are not loaded")
										const newOsm = await applyChanges()
										if (changesetStats.osmId === base.osm?.id) {
											base.setOsm(newOsm)
										} else if (changesetStats.osmId === patch.osm?.id) {
											patch.setOsm(newOsm)
										} else {
											throw Error(
												"Changeset OSM ID does not match base or patch OSM ID",
											)
										}
										return "Changes applied"
									})
								}
							>
								Apply changes
							</ActionButton>
						)}
					</Step>

					<Step step="deduplicate-nodes" title="DE-DUPLICATE NODES">
						<p>
							Identify nodes that occupy the same location in both datasets and
							merge them, updating any way or relation references that point to
							those nodes.
						</p>

						<div className="flex flex-col border-1">
							<div className="flex flex-row justify-between">
								<div className="font-bold p-2">CURRENT OSM PBF</div>
								{base.osm && (
									<ActionButton
										icon={<DownloadIcon />}
										onAction={base.downloadOsm}
									/>
								)}
							</div>
							<OsmInfoTable
								defaultOpen={false}
								osm={base.osm}
								file={base.file}
							/>
						</div>

						<ButtonGroup className="w-full">
							<ActionButton
								className="flex-1"
								icon={<SkipForwardIcon />}
								onAction={async () => goToStep("inspect-final-osm")}
							>
								Skip
							</ActionButton>
							<ButtonGroupSeparator />
							<ActionButton
								className="flex-1"
								icon={<FileDiff />}
								onAction={() =>
									startStepTask("De-duplicating nodes and ways", async () => {
										if (!base.osm || !patch.osm)
											throw Error("Missing data to generate changes")
										const results = await osmWorker.dedupeNodesAndWays(
											base.osm.id,
										)
										setChangesetStats(results)
										return changeStatsSummary(results)
									})
								}
							>
								De-duplicate nodes
							</ActionButton>
						</ButtonGroup>
					</Step>

					<Step step="create-intersections" title="CREATE INTERSECTIONS">
						<div className="flex flex-col space-y-2">
							<p>
								Scan new ways for crossings with existing ways and flag the
								segments that should share intersection nodes based on their
								tags.
							</p>
							<p>
								We quickly search for nearby ways and keep only those whose tags
								allow an intersection: both must be linear, share the same
								`layer` value if present, include a `highway` tag, and avoid
								bridge or tunnel tags.
							</p>
							<p>
								For each candidate we locate the precise crossover point.
								Existing nodes at that point are reused, favoring nodes
								introduced by the patch; otherwise we create a new node.
							</p>
							<p>
								Finally, we update the way geometries so they reference the
								chosen intersection node. You can review and apply those edits
								in the next screen.
							</p>
						</div>

						<ButtonGroup className="w-full">
							<ActionButton
								className="flex-1"
								icon={<SkipForwardIcon />}
								onAction={async () => goToStep("inspect-final-osm")}
							>
								Skip
							</ActionButton>
							<ButtonGroupSeparator />
							<ActionButton
								className="flex-1"
								icon={<FileDiff />}
								onAction={() =>
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
										setChangesetStats(results)
										return changeStatsSummary(results)
									})
								}
							>
								Create intersections
							</ActionButton>
						</ButtonGroup>
					</Step>

					<Step step="inspect-final-osm" title="INSPECT FINAL MERGED OSM">
						<p>
							Review the merged OSM dataset, explore the results on the map, and
							download the new PBF when ready. Zoom in to inspect individual
							entities and confirm the applied changes.
						</p>

						{base.osm && (
							<>
								<div className="flex flex-col border-1">
									<div className="font-bold p-2">NEW OSM PBF</div>
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

								<ActionButton
									icon={<DownloadIcon />}
									onAction={() => base.downloadOsm()}
								>
									Download merged OSM PBF
								</ActionButton>
							</>
						)}
					</Step>
				</div>
				<SidebarLog />
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
										html: `<div className="p-2">node</div>`,
									}
								}
								if (sourceLayerId.includes("ways")) {
									return {
										className: "deck-tooltip",
										style: deckTooltipStyle,
										html: `<div className="p-2">way</div>`,
									}
								}
							}
							return null
						}}
					/>
					{base.osm && <OsmixRasterSource osmId={base.osm.id} />}
					{patch.osm && <OsmixRasterSource osmId={patch.osm.id} />}

					<CustomControl position="top-left">
						<NominatimSearchControl />
					</CustomControl>
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
			<div className="flex items-center gap-1">
				<Spinner />
				<div className="font-bold">PLEASE WAIT...</div>
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
