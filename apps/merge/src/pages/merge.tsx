import { changeStatsSummary } from "@osmix/change"
import { atom, useAtom, useAtomValue, useSetAtom } from "jotai"
import {
	ArrowLeft,
	ArrowRightIcon,
	CheckCircle,
	ChevronRightIcon,
	DownloadIcon,
	EyeIcon,
	FastForwardIcon,
	FileDiff,
	MaximizeIcon,
	MergeIcon,
	SaveIcon,
	SearchCodeIcon,
	SkipForwardIcon,
	XIcon,
} from "lucide-react"
import { showSaveFilePicker } from "native-file-system-adapter"
import { Suspense, useMemo } from "react"
import { Link } from "react-router"
import ActionButton from "../components/action-button"
import Basemap from "../components/basemap"
import CustomControl from "../components/custom-control"
import { Details, DetailsContent, DetailsSummary } from "../components/details"
import EntityDetails from "../components/entity-details"
import EntityDetailsMapControl from "../components/entity-details-map-control"
import { Main, MapContent, Sidebar } from "../components/layout"
import ChangesSummary, {
	ChangesExpandableList,
	ChangesFilters,
	ChangesPagination,
} from "../components/osm-changes-summary"
import OsmInfoTable from "../components/osm-info-table"
import OsmixRasterSource from "../components/osmix-raster-source"
import OsmixVectorOverlay from "../components/osmix-vector-overlay"
import SelectedEntityLayer from "../components/selected-entity-layer"
import SidebarLog from "../components/sidebar-log"
import StoredOsmList from "../components/stored-osm-list"
import { Button } from "../components/ui/button"
import {
	ButtonGroup,
	ButtonGroupSeparator,
} from "../components/ui/button-group"
import { Card, CardContent, CardHeader } from "../components/ui/card"
import {
	Item,
	ItemActions,
	ItemContent,
	ItemDescription,
	ItemMedia,
	ItemTitle,
} from "../components/ui/item"
import { Spinner } from "../components/ui/spinner"
import { useFlyToEntity, useFlyToOsmBounds } from "../hooks/map"
import { useOsmFile } from "../hooks/osm"
import { cn } from "../lib/utils"
import { changesetStatsAtom } from "../state/changes"
import { Log } from "../state/log"
import { selectedEntityAtom, selectOsmEntityAtom } from "../state/osm"
import { osmWorker } from "../state/worker"

const STEPS = [
	"select-osm-pbf-files",
	"inspect-base-osm",
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
	"run-all-steps",
] as const

const stepIndexAtom = atom<number>(0)
const stepAtom = atom<(typeof STEPS)[number] | null>((get) => {
	const stepIndex = get(stepIndexAtom)
	return STEPS[stepIndex]
})

export default function Merge() {
	const base = useOsmFile("base")
	const patch = useOsmFile("patch")
	const [changesetStats, setChangesetStats] = useAtom(changesetStatsAtom)
	const flyToEntity = useFlyToEntity()
	const flyToOsmBounds = useFlyToOsmBounds()
	const selectedEntity = useAtomValue(selectedEntityAtom)
	const selectEntity = useSetAtom(selectOsmEntityAtom)
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
		await osmWorker.applyChangesAndReplace(changesetStats.osmId)
		const osm = await osmWorker.get(changesetStats.osmId)
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
					<Step step="select-osm-pbf-files" title="SELECT OSM FILES">
						<p>Select two OSM files (PBF or GeoJSON) to merge.</p>

						<Card>
							<CardHeader>
								<div className="p-2">BASE OSM</div>
								{base.osm && (
									<ButtonGroup>
										{!base.isStored && (
											<ActionButton
												icon={<SaveIcon />}
												title="Save to storage"
												variant="ghost"
												onAction={base.saveToStorage}
											/>
										)}
										<ActionButton
											icon={<XIcon />}
											title="Clear base OSM file"
											variant="ghost"
											onAction={async () => {
												await base.loadOsmFile(null)
											}}
										/>
									</ButtonGroup>
								)}
							</CardHeader>
							<CardContent>
								{!base.osm ? (
									<StoredOsmList
										openOsmFile={async (file) => {
											const osmInfo =
												typeof file === "string"
													? await base.loadFromStorage(file)
													: await base.loadOsmFile(file)
											flyToOsmBounds(osmInfo)
											return osmInfo
										}}
									/>
								) : (
									<OsmInfoTable
										defaultOpen={false}
										osm={base.osm}
										file={base.file}
										fileInfo={base.fileInfo}
									/>
								)}
							</CardContent>
						</Card>

						<Card>
							<CardHeader>
								<div className="p-2">PATCH OSM</div>
								{patch.osm && (
									<ButtonGroup>
										{!patch.isStored && (
											<ActionButton
												icon={<SaveIcon />}
												title="Save to storage"
												variant="ghost"
												onAction={patch.saveToStorage}
											/>
										)}
										<ActionButton
											icon={<XIcon />}
											title="Clear patch OSM file"
											variant="ghost"
											onAction={async () => {
												await patch.loadOsmFile(null)
											}}
										/>
									</ButtonGroup>
								)}
							</CardHeader>
							<CardContent>
								{!patch.osm ? (
									<StoredOsmList
										openOsmFile={async (file) => {
											const osmInfo =
												typeof file === "string"
													? await patch.loadFromStorage(file)
													: await patch.loadOsmFile(file)
											flyToOsmBounds(osmInfo)
											return osmInfo
										}}
									/>
								) : (
									<OsmInfoTable
										defaultOpen={false}
										osm={patch.osm}
										file={patch.file}
										fileInfo={patch.fileInfo}
									/>
								)}
							</CardContent>
						</Card>

						<div className="flex flex-col gap-2">
							<div className="font-bold">MERGE STEPS</div>
							<ol className="list-decimal list-inside">
								<li>Deduplicate nodes and ways in base OSM</li>
								<li>Deduplicate nodes and ways in patch OSM</li>
								<li>Merge patch OSM onto base OSM.</li>
								<li>Deduplicate nodes and ways in newly merged OSM</li>
								<li>
									Create new intersections in merged data where ways cross
								</li>
							</ol>
							<p>
								Note: entities from the patch file are prioritized over matching
								entities in the base file.
							</p>
						</div>
						<div
							className={cn(
								"flex flex-col gap-4",
								!base.osm || !patch.osm ? "opacity-50 pointer-events-none" : "",
							)}
						>
							<Item asChild>
								<a
									href="#"
									onClick={(e) => {
										e.preventDefault()
										nextStep()
									}}
								>
									<ItemMedia>
										<CheckCircle />
									</ItemMedia>
									<ItemContent>
										<ItemTitle>OPTION 1. VERIFY EACH STEP</ItemTitle>
										<ItemDescription>
											Verify changes before applying them.
										</ItemDescription>
									</ItemContent>
									<ItemActions>
										<ChevronRightIcon />
									</ItemActions>
								</a>
							</Item>
							<Item asChild>
								<a
									href="#"
									onClick={async (e) => {
										e.preventDefault()
										goToStep("run-all-steps")
										const task = Log.startTask(
											"Running all merge steps, please wait...",
										)
										if (!base.osm) throw Error("Base OSM is not loaded")
										if (!patch.osm) throw Error("Patch OSM is not loaded")

										setChangesetStats(null)
										const osmId = await osmWorker.merge(
											base.osm.id,
											patch.osm.id,
											{
												deduplicateNodes: true,
												deduplicateWays: true,
												directMerge: true,
												createIntersections: true,
											},
										)
										// Use setMergedOsm to properly update file info for the new merged result
										await base.setMergedOsm(osmId)
										patch.setOsm(null)

										task.end("All merge steps completed")
										goToStep("inspect-final-osm")
									}}
								>
									<ItemMedia>
										<FastForwardIcon />
									</ItemMedia>
									<ItemContent>
										<ItemTitle>OPTION 2. RUN ALL MERGE STEPS</ItemTitle>
										<ItemDescription>
											Run without stopping for verification.
										</ItemDescription>
									</ItemContent>
									<ItemActions>
										<ChevronRightIcon />
									</ItemActions>
								</a>
							</Item>
						</div>
					</Step>

					<Step step="run-all-steps" title="RUNNING ALL MERGE STEPS">
						<p>
							Monitor the activity log below for progress. This may take a few
							minutes to complete.
						</p>
					</Step>

					<Step step="inspect-base-osm" title="INSPECT BASE OSM">
						<p>
							Each file is first scanned for duplicate entities inside the same
							dataset. We then look for duplicates that appear in both files.
						</p>
						<p>
							Duplicates are features that share an ID or occupy the same
							geometry. We prefer entities with newer version metadata; if that
							information is missing we keep the feature with more tags.
						</p>
						<p>
							When a duplicate is detected we draft a changeset entry that
							removes the extra copy. Review those proposals in the next step
							before applying them.
						</p>
						<Card>
							<CardHeader className="p-2">BASE OSM PBF</CardHeader>
							<CardContent>
								<OsmInfoTable
									defaultOpen={false}
									osm={base.osm}
									file={base.file}
									fileInfo={base.fileInfo}
								/>
							</CardContent>
						</Card>
						<ActionButton
							disabled={!base.osm}
							icon={<SearchCodeIcon />}
							onAction={() =>
								startStepTask(
									"Inspecting base OSM for duplicate entities",
									async () => {
										if (!base.osm) throw Error("Base OSM is not loaded")
										const changes = await osmWorker.generateChangeset(
											base.osm.id,
											base.osm.id,
											{
												deduplicateNodes: true,
												deduplicateWays: true,
											},
										)
										setChangesetStats(changes)
										return changeStatsSummary(changes)
									},
								)
							}
						>
							Deduplicate base OSM
						</ActionButton>
					</Step>

					<Step step="inspect-patch-osm" title="INSPECT PATCH OSM">
						<p>
							Generate a changeset that removes duplicate entities from the
							patch file before it is merged into the base data.
						</p>

						<Card>
							<CardHeader className="p-2">PATCH OSM PBF</CardHeader>
							<CardContent>
								<OsmInfoTable
									defaultOpen={false}
									osm={patch.osm}
									file={patch.file}
									fileInfo={patch.fileInfo}
								/>
							</CardContent>
						</Card>
						<ActionButton
							disabled={!patch.osm}
							icon={<SearchCodeIcon />}
							onAction={() =>
								startStepTask(
									"Inspecting patch OSM for duplicate entities",
									async () => {
										if (!patch.osm) throw Error("Patch OSM is not loaded")
										const patchChanges = await osmWorker.generateChangeset(
											patch.osm.id,
											patch.osm.id,
											{
												deduplicateNodes: true,
												deduplicateWays: true,
											},
										)
										setChangesetStats(patchChanges)
										return changeStatsSummary(patchChanges)
									},
								)
							}
						>
							Deduplicate patch OSM
						</ActionButton>
					</Step>

					<Step step="direct-merge" title="DIRECT MERGE">
						<p>
							Add the patch entities to the base dataset and replace any base
							features that share the same IDs.
						</p>

						<Card>
							<CardHeader>
								<div className="p-2">BASE OSM PBF</div>

								{base.osm && (
									<ActionButton
										icon={<DownloadIcon />}
										onAction={base.downloadOsm}
										variant="ghost"
									/>
								)}
							</CardHeader>
							<CardContent>
								<OsmInfoTable
									defaultOpen={false}
									osm={base.osm}
									file={base.file}
									fileInfo={base.fileInfo}
								/>
							</CardContent>
						</Card>
						<Card>
							<CardHeader>
								<div className="p-2">PATCH OSM PBF</div>
								{patch.osm && (
									<ActionButton
										icon={<DownloadIcon />}
										onAction={patch.downloadOsm}
										variant="ghost"
									/>
								)}
							</CardHeader>
							<CardContent>
								<OsmInfoTable
									defaultOpen={false}
									osm={patch.osm}
									file={patch.file}
									fileInfo={patch.fileInfo}
								/>
							</CardContent>
						</Card>

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
							<Card>
								<CardHeader className="p-2">Changeset</CardHeader>
								<CardContent>
									<ChangesSummary />
									<Suspense fallback={<div className="p-2">LOADING...</div>}>
										<Details>
											<DetailsSummary>ALL CHANGES</DetailsSummary>
											<DetailsContent>
												<ChangesFilters />
												<ChangesExpandableList />
												<ChangesPagination />
											</DetailsContent>
										</Details>
									</Suspense>
								</CardContent>
							</Card>
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
								Apply all changes
							</ActionButton>
						)}
					</Step>

					<Step step="deduplicate-nodes" title="DE-DUPLICATE NODES">
						<p>
							Identify nodes that occupy the same location in both datasets and
							merge them, updating any way or relation references that point to
							those nodes.
						</p>

						<Card>
							<CardHeader>
								<div className="p-2">CURRENT OSM PBF</div>
								{base.osm && (
									<ActionButton
										icon={<DownloadIcon />}
										onAction={base.downloadOsm}
										variant="ghost"
									/>
								)}
							</CardHeader>
							<CardContent>
								<OsmInfoTable
									defaultOpen={false}
									osm={base.osm}
									file={base.file}
									fileInfo={base.fileInfo}
								/>
							</CardContent>
						</Card>

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
										const results = await osmWorker.generateChangeset(
											base.osm.id,
											patch.osm.id,
											{
												deduplicateNodes: true,
												deduplicateWays: true,
											},
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
								<Card>
									<CardHeader className="p-2">NEW OSM PBF</CardHeader>
									<CardContent>
										<OsmInfoTable
											defaultOpen={false}
											osm={base.osm}
											file={base.file}
											fileInfo={base.fileInfo}
										/>
									</CardContent>
								</Card>

								{selectedEntity && (
									<Card>
										<CardHeader>
											<div className="p-2">SELECTED ENTITY</div>
											<Button
												onClick={() => {
													if (!base.osm || !selectedEntity) return
													flyToEntity(base.osm, selectedEntity)
												}}
												variant="ghost"
												size="icon-sm"
												title="Fit bounds to entity"
											>
												<MaximizeIcon />
											</Button>
										</CardHeader>
										<CardContent>
											<EntityDetails
												entity={selectedEntity}
												defaultOpen={true}
												osm={base.osm}
											/>
										</CardContent>
									</Card>
								)}

								<div className="flex flex-col gap-2">
									<ActionButton
										icon={<DownloadIcon />}
										onAction={() => base.downloadOsm()}
									>
										Download merged OSM PBF
									</ActionButton>
									{!base.isStored && (
										<ActionButton
											icon={<SaveIcon />}
											onAction={base.saveToStorage}
										>
											Save to storage
										</ActionButton>
									)}
									<Button asChild>
										<Link
											to={
												base.isStored && base.fileInfo?.fileHash
													? `/inspect?load=${base.fileInfo.fileHash}`
													: "/inspect"
											}
										>
											<EyeIcon /> Open in Inspect
										</Link>
									</Button>
								</div>
							</>
						)}
					</Step>
				</div>
				<SidebarLog />
			</Sidebar>
			<MapContent>
				<Basemap>
					{base.osm && <OsmixRasterSource osmId={base.osm.id} />}
					{patch.osm && <OsmixRasterSource osmId={patch.osm.id} />}
					{base.osm && <OsmixVectorOverlay osm={base.osm} />}
					{stepIndex === 0 && patch.osm && (
						<OsmixVectorOverlay osm={patch.osm} />
					)}

					<SelectedEntityLayer />

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
