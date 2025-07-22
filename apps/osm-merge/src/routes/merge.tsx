"use client"

import {
	addLogMessageAtom,
	applyAllChangesAtom,
	baseNodesNearPatchAtom,
	beginMergeAtom,
	currentChangeEntityBboxAtom,
	currentStatusAtom,
	mapAtom,
	runFullMergeAtom,
	workflowStepAtom,
} from "@/atoms"
import {
	currentChangeEntityAtom,
	deckGlLayersAtom,
	fileAtomFamily,
	osmAtomFamily,
	patchIndexAtom,
	patchesAtom,
} from "@/atoms"
import Basemap from "@/components/basemap"
import CenterInfo from "@/components/center-info"
import DeckGlOverlay from "@/components/deckgl-overlay"
import OsmPbfFilePicker from "@/components/filepicker"
import { Button } from "@/components/ui/button"
import ZoomInfo from "@/components/zoom-info"
import { cn } from "@/lib/utils"
import ObjectToTable from "@/object-to-table"
import { objectToHtmlTableString } from "@/utils"
import { useAtom, useAtomValue, useSetAtom } from "jotai"
import { ArrowLeft, ArrowRight, Loader2Icon, MaximizeIcon } from "lucide-react"
import { showSaveFilePicker } from "native-file-system-adapter"
import { getEntityType, writePbfToStream, type Osm } from "osm.ts"
import { isWay } from "osm.ts/utils"
import { useCallback, useEffect } from "react"

function layerIdToName(id: string) {
	if (id === "osm-tk:patch-geojson") return "Patch"
	if (id === "osm-tk:base-geojson") return "Base"
	if (id === "osm-tk:patch-way-geojson") return "Current Way"
	return id
}

const DEFAULT_BASE_PBF_URL = "./pbfs/yakima-full.osm.pbf"
const DEFAULT_PATCH_PBF_URL = "./pbfs/yakima-osw.osm.pbf"

/**
 * Eventual workflow:
 * Step 1: Select base and patch OSM files. View OSM data on the map.
 * Step 2: Click "Begin Merge" to start the merge process.
 * Step 3: View all initial changes (adding new nodes, ways, etc. and replacing existing ones with the same ID). Can click "next", "previous", or "exclude"
 * Step 4: Click "Accept changes" to apply them to the base OSM.
 * Step 5: Handle overlapping nodes (where nodes have the same coordinates).
 * Step 6: Handle intersecting ways -- how to filter? Only with `tag[highway]`?
 * Step 7: Show "disconnected ways" -- ways that are not connected to any other way.
 * Step 8: Click "Download Merged OSM" to download the merged OSM file.
 */

export default function MergePage() {
	const [baseFile, setBaseFile] = useAtom(fileAtomFamily("base"))
	const [patchFile, setPatchFile] = useAtom(fileAtomFamily("patch"))
	const beginMerge = useSetAtom(beginMergeAtom)
	const applyAllChanges = useSetAtom(applyAllChangesAtom)
	const runFullMerge = useSetAtom(runFullMergeAtom)
	const logMessage = useSetAtom(addLogMessageAtom)
	const baseOsm = useAtomValue(osmAtomFamily("base"))
	const patchOsm = useAtomValue(osmAtomFamily("patch"))
	const workflowStep = useAtomValue(workflowStepAtom)

	const [patches, setPatches] = useAtom(patchesAtom)
	const [patchIndex, setPatchIndex] = useAtom(patchIndexAtom)
	const map = useAtomValue(mapAtom)
	const deckGlLayers = useAtomValue(deckGlLayersAtom)
	const currentWay = useAtomValue(currentChangeEntityAtom)
	const currentWayBbox = useAtomValue(currentChangeEntityBboxAtom)
	const baseNodesNearWay = useAtomValue(baseNodesNearPatchAtom)

	useEffect(() => {
		if (map && currentWayBbox) {
			map.fitBounds(currentWayBbox, {
				padding: 100,
				maxDuration: 200,
				maxZoom: 19,
			})
		}
	}, [map, currentWayBbox])

	// Auto load default files for faster testing
	useEffect(() => {
		if (process.env.NODE_ENV !== "development") {
			logMessage("Ready", "ready")
			return
		}
		if (!baseFile && !patchFile) {
			logMessage("Loading development files...")
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
			]).then(() => {
				// beginMerge()
				logMessage("Ready", "ready")
			})
		}
	}, [baseFile, patchFile, setBaseFile, setPatchFile, logMessage])

	const downloadPbf = useCallback(async () => {
		if (baseOsm == null) return
		logMessage("Generating OSM file to download", "info")
		const fileHandle = await showSaveFilePicker({
			suggestedName: "merged.osm.pbf",
			types: [
				{
					description: "OSM PBF",
					accept: { "application/x-protobuf": [".pbf"] },
				},
			],
		})
		const stream = await fileHandle.createWritable()
		const primitives = baseOsm.generatePbfPrimitiveBlocks()
		await writePbfToStream(stream, baseOsm.header, primitives)
		await stream.close()
		logMessage(`Created ${fileHandle.name} PBF for download`, "ready")
	}, [baseOsm, logMessage])

	return (
		<div className="h-screen w-screen flex flex-col">
			<div className="border-b flex flex-row justify-between items-center">
				<h1 className="py-2 px-4">OSM Merge</h1>
				<Status />
				<div className="flex flex-row gap-4 items-center px-4">
					<div className="border-r pr-4">
						<CenterInfo />
					</div>
					<div>
						<ZoomInfo />z
					</div>
				</div>
			</div>
			<div className="flex flex-row grow-1 h-full overflow-hidden">
				<div className="flex flex-col w-96 gap-4 py-4 overflow-y-auto">
					<OsmFilePicker />
					{workflowStep === "merge-complete" && (
						<Button
							className="mx-4"
							onClick={() => {
								downloadPbf()
							}}
						>
							Download Merged OSM
						</Button>
					)}
					{workflowStep === "select-files" && baseOsm && patchOsm && (
						<>
							<Button
								className="mx-4"
								onClick={() => {
									runFullMerge()
								}}
							>
								Run auto-merge
							</Button>
							<Button className="mx-4" onClick={() => beginMerge()}>
								Begin merge workflow
							</Button>
						</>
					)}
					{workflowStep === "verify-changes" && currentWay && (
						<div className="flex flex-col gap-2 px-4">
							<Button onClick={() => applyAllChanges()}>
								Accept all changes
							</Button>

							<div className="flex flex-row justify-between items-center">
								<h3>Verify Changes</h3>
								<div className="flex flex-row gap-2 items-center">
									<Button
										disabled={patchIndex === 0}
										size="icon"
										className="size-8"
										variant="ghost"
										onClick={() => {
											setPatchIndex((p) => p - 1)
										}}
									>
										<ArrowLeft />
									</Button>
									<div>
										{patchIndex + 1} / {patches.length.toLocaleString()}
									</div>
									<Button
										size="icon"
										className="size-8"
										variant="ghost"
										onClick={() => {
											setPatchIndex((p) => p + 1)
										}}
									>
										<ArrowRight />
									</Button>
								</div>
							</div>
							<hr />
							<h3>Type: {patches[patchIndex].changeType}</h3>
							<h3>Entity Type: {getEntityType(currentWay)}</h3>
							<h3>Entity ID: {currentWay.id}</h3>
							<div>Nodes: {isWay(currentWay) ? currentWay.refs.length : 0}</div>
							<div className="flex flex-col">
								<h3>Patch - Base Node Candidates</h3>
								<table>
									<tbody>
										{baseNodesNearWay.map((node) => (
											<tr key={`${node.patchNode.id}-${node.baseNode.id}`}>
												<td>{node.patchNode.id}</td>
												<td>{node.baseNode.id}</td>
												<td>{node.distance.toFixed(2)}</td>
											</tr>
										))}
									</tbody>
								</table>
							</div>
							<div className="flex flex-col">
								<h3 className="border-t border-l border-r px-2 py-1">Tags</h3>
								<table>
									<ObjectToTable object={currentWay.tags ?? {}} />
								</table>
							</div>
						</div>
					)}
					{workflowStep === "deduplicate-nodes" && (
						<div className="flex flex-col gap-2 px-4">
							<h3>Deduplicate Nodes</h3>
						</div>
					)}
					{workflowStep === "create-intersections" && (
						<div className="flex flex-col gap-2 px-4">
							<h3>Create Intersections</h3>
						</div>
					)}
				</div>
				<div className="relative grow-3">
					<Basemap>
						<DeckGlOverlay
							layers={deckGlLayers}
							getTooltip={(pi) => {
								if (!pi.object) return null
								// console.log(pi)
								return {
									className: "deck-tooltip",
									html: `
                                    <h3>${layerIdToName(pi.layer?.id ?? "")}</h3>
                                    <hr />
                                    <h3>${pi.object.geometry.type === "Point" ? "Node" : "Way"}: ${pi.object.id}</h3>
                                    <table><tbody>${objectToHtmlTableString(pi.object.properties)}</tbody></table>
                                    `,
								}
							}}
						/>
					</Basemap>
				</div>
			</div>
		</div>
	)
}

function OsmFilePicker() {
	const workflowStep = useAtomValue(workflowStepAtom)
	const [baseFile, setBaseFile] = useAtom(fileAtomFamily("base"))
	const [patchFile, setPatchFile] = useAtom(fileAtomFamily("patch"))
	const baseOsm = useAtomValue(osmAtomFamily("base"))
	const patchOsm = useAtomValue(osmAtomFamily("patch"))
	const map = useAtomValue(mapAtom)

	return (
		<div className="flex flex-col gap-2 px-4">
			<div className="flex flex-col gap-1">
				<div className="flex flex-row justify-between items-center">
					<h3>Base: {baseFile?.name}</h3>
					<div>
						<Button
							variant="ghost"
							size="icon"
							title="Fit map to OSM bounds"
							onClick={() => {
								const bbox = baseOsm?.bbox()
								if (!bbox) return
								map?.fitBounds(bbox, {
									padding: 100,
									maxDuration: 200,
								})
							}}
						>
							<MaximizeIcon />
						</Button>
					</div>
				</div>
				{workflowStep === "select-files" && (
					<OsmPbfFilePicker file={baseFile} setFile={setBaseFile} />
				)}
				<OsmInfoTable osm={baseOsm} />
			</div>
			<div className="flex flex-col gap-1">
				<div className="flex flex-row justify-between items-center">
					<h3>Patch: {patchFile?.name}</h3>
					<div>
						<Button
							variant="ghost"
							size="icon"
							title="Fit map to OSM bounds"
							onClick={() => {
								const bbox = patchOsm?.bbox()
								if (!bbox) return
								map?.fitBounds(bbox, {
									padding: 100,
									maxDuration: 200,
								})
							}}
						>
							<MaximizeIcon />
						</Button>
					</div>
				</div>
				{workflowStep === "select-files" && (
					<OsmPbfFilePicker file={patchFile} setFile={setPatchFile} />
				)}
				<OsmInfoTable osm={patchOsm} />
			</div>
		</div>
	)
}

function OsmInfoTable({ osm }: { osm: Osm | null }) {
	if (!osm) return null
	return (
		<details>
			<summary>Osm Info</summary>
			<table>
				<ObjectToTable object={osm.header} />
				<tbody>
					<tr>
						<td>ways</td>
						<td>{osm.ways.size.toLocaleString()}</td>
					</tr>
					<tr>
						<td>nodes</td>
						<td>{osm.nodes.size.toLocaleString()}</td>
					</tr>
					<tr>
						<td>relations</td>
						<td>{osm.relations.size.toLocaleString()}</td>
					</tr>
				</tbody>
			</table>
		</details>
	)
}

function Status() {
	const status = useAtomValue(currentStatusAtom)
	console.log("current status", status)
	return (
		<div className="flex flex-row gap-2 items-center px-4">
			<div className="flex flex-row gap-2 items-center">
				{status.type === "info" ? (
					<Loader2Icon className="animate-spin size-4" />
				) : (
					<div
						className={cn(
							"w-2 h-2 rounded-full",
							status.type === "ready" && "bg-green-500",
							status.type === "error" && "bg-red-500",
						)}
					/>
				)}
				<div>{status.message}</div>
			</div>
		</div>
	)
}
