import { useBitmapTileLayer } from "@/hooks/map"
import { useOsmFile, useOsmWorker } from "@/hooks/osm"
import { mapAtom } from "@/state/map"
import { useAtomValue } from "jotai"
import { OsmChangeset, type OsmChanges } from "osm.ts"
import { useEffect, useMemo, useState, useTransition } from "react"
import Basemap from "./basemap"
import DeckGlOverlay from "./deckgl-overlay"
import { Main, MapContent, Sidebar } from "./layout"
import OsmInfoTable from "./osm-info-table"
import OsmPbfFileInput from "./osm-pbf-file-input"
import { Button } from "./ui/button"
import LogContent from "./log"
import { ArrowLeft, ArrowRight, Loader2Icon } from "lucide-react"
import { DEFAULT_BASE_PBF_URL, DEFAULT_PATCH_PBF_URL } from "@/settings"

export default function Merge() {
	const [baseFile, setBaseFile] = useState<File | null>(null)
	const [patchFile, setPatchFile] = useState<File | null>(null)
	const [baseOsm, baseOsmIsLoading] = useOsmFile(baseFile, "base")
	const [patchOsm, patchOsmIsLoading] = useOsmFile(patchFile, "patch")
	const osmWorker = useOsmWorker()
	const [isTransitioning, startTransition] = useTransition()
	const [changes, setChanges] = useState<OsmChanges | null>(null)

	const baseTileLayer = useBitmapTileLayer(baseOsm)
	const patchTileLayer = useBitmapTileLayer(patchOsm)

	const [showMergeWizard, setShowMergeWizard] = useState(false)

	const [step, setStep] = useState<number>(1)

	const [mergeOptions, setMergeOptions] = useState({
		simple: true,
		deduplicateNodes: true,
		createIntersections: true,
	})

	// Auto load default files for faster testing
	useEffect(() => {
		if (process.env.NODE_ENV !== "development") return
		if (!baseFile && !patchFile) {
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

	return (
		<Main>
			<Sidebar>
				<div className="flex flex-col p-1 gap-2">
					<If t={step === 1}>
						<div className="font-bold">1: SELECT OSM PBF FILES</div>
						<div>
							Select two PBF files to merge. Note: entities from the patch file
							are prioritized over matching entities in the base file.
						</div>
						<hr />
						<div>
							<div className="font-bold">BASE OSM PBF</div>
							<OsmPbfFileInput
								file={baseFile}
								isLoading={baseOsmIsLoading}
								setFile={setBaseFile}
							/>
							<OsmInfoTable osm={baseOsm} file={baseFile} />
						</div>
						<div>
							<div className="font-bold">PATCH OSM PBF</div>
							<OsmPbfFileInput
								file={patchFile}
								isLoading={patchOsmIsLoading}
								setFile={setPatchFile}
							/>
							<OsmInfoTable osm={patchOsm} file={patchFile} />
						</div>
						<Button disabled={!baseOsm || !patchOsm} onClick={() => setStep(2)}>
							<ArrowRight /> Next step
						</Button>
					</If>

					<If t={step === 2}>
						<div className="font-bold">2: SELECT MERGE OPTIONS</div>
						<div>
							Select merge options before generating a changeset. Note:
							changeset generation can take some time.
						</div>
						<div>
							<div className="font-bold">BASE OSM PBF</div>
							<OsmInfoTable osm={baseOsm} file={baseFile} />
						</div>
						<div>
							<div className="font-bold">PATCH OSM PBF</div>
							<OsmInfoTable osm={patchOsm} file={patchFile} />
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
								setStep(3)
								startTransition(async () => {
									if (!baseOsm || !patchOsm || !osmWorker)
										throw Error("Missing data to generate changes")
									const results = await osmWorker.generateChangeset(
										baseOsm.id,
										patchOsm.id,
									)
									setChanges(results)
								})
							}}
						>
							Generate changeset
						</Button>
						<Button variant="outline" onClick={() => setStep(1)}>
							<ArrowLeft /> Back
						</Button>
					</If>

					<If t={step === 3}>
						{isTransitioning ? (
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
							<LogContent />
						</div>
					</If>

					<If t={step === 4}>
						{isTransitioning ? (
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
								{/* INSERT OSM VIEW CODE HERE */}
							</>
						)}
					</If>
				</div>
			</Sidebar>
			<MapContent>
				<Basemap>
					<DeckGlOverlay layers={[baseTileLayer, patchTileLayer]} />
				</Basemap>
			</MapContent>
		</Main>
	)
}

function If({ children, t }: { children: React.ReactNode; t: boolean }) {
	if (!t) return null
	return <>{children}</>
}
