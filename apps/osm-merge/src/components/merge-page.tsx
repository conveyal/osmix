import { useBitmapTileLayer } from "@/hooks/map"
import { useOsmFile, useOsmWorker } from "@/hooks/osm"
import { DEFAULT_BASE_PBF_URL, DEFAULT_PATCH_PBF_URL } from "@/settings"
import { ArrowLeft, ArrowRight, Loader2Icon } from "lucide-react"
import { Osm, writeOsmToPbfStream, type OsmChanges } from "osm.ts"
import { showSaveFilePicker } from "native-file-system-adapter"
import { useCallback, useEffect, useRef, useState, useTransition } from "react"
import Basemap from "./basemap"
import DeckGlOverlay from "./deckgl-overlay"
import { Main, MapContent, Sidebar } from "./layout"
import LogContent from "./log"
import OsmInfoTable from "./osm-info-table"
import OsmPbfFileInput from "./osm-pbf-file-input"
import { Button } from "./ui/button"
import useStartTask from "@/hooks/log"

export default function Merge() {
	const [baseFile, setBaseFile] = useState<File | null>(null)
	const [patchFile, setPatchFile] = useState<File | null>(null)
	const [baseOsm, setBaseOsm, baseOsmIsLoading] = useOsmFile(baseFile, "base")
	const [patchOsm, setPatchOsm, patchOsmIsLoading] = useOsmFile(
		patchFile,
		"patch",
	)
	const [mergedOsm, setMergedOsm] = useState<Osm | null>(null)
	const osmWorker = useOsmWorker()
	const [isTransitioning, startTransition] = useTransition()
	const [changes, setChanges] = useState<OsmChanges | null>(null)
	const startTask = useStartTask()

	const baseTileLayer = useBitmapTileLayer(baseOsm)
	const patchTileLayer = useBitmapTileLayer(patchOsm)
	const mergedTileLayer = useBitmapTileLayer(mergedOsm)

	const [step, setStep] = useState<number>(1)

	const [mergeOptions, setMergeOptions] = useState({
		simple: true,
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
				await stream.close()
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
							<ArrowRight /> Next step
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
								<b>SIMPLE MERGE:</b> Add all new entities from the patch onto
								the base data set. Overwrite any entities that have matching
								IDs.
							</p>
							<input
								type="checkbox"
								checked={mergeOptions.simple}
								onChange={(e) => {
									const simple = e.currentTarget.checked
									setMergeOptions((m) => ({
										...m,
										simple,
									}))
								}}
							/>
						</div>
						<div className="p-2 border border-slate-950 flex gap-2">
							<p>
								<b>DEDUPLICATE NODES:</b> Search for geographically identical
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
								<b>CREATE INTERSECTIONS:</b> Look for new ways that cross over
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
									)
									console.log(results)
									setChanges(results)
								})
							}}
						>
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
						<div className="border border-slate-950 p-1 max-h-96">
							{changes && <ChangesSummary changes={changes} />}
						</div>
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
							<ArrowRight /> Apply changes (irreversible)
						</Button>
						<Button variant="outline" onClick={prevStep}>
							<ArrowLeft /> Back
						</Button>
					</If>

					<If t={step === 4}>
						{isTransitioning || mergedOsm == null ? (
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
								</div>
								<Button onClick={() => downloadOsm(mergedOsm)}>
									Download merged OSM PBF
								</Button>
								{/* INSERT OSM VIEW CODE HERE */}
							</>
						)}
					</If>
				</div>
			</Sidebar>
			<MapContent>
				<Basemap>
					<DeckGlOverlay
						layers={[baseTileLayer, patchTileLayer, mergedTileLayer]}
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
	return <div>ChangesSummary</div>
}
