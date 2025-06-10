"use client"

import { baseNodesNearPatchAtom, beginMergeAtom, mapAtom } from "@/atoms"
import Basemap from "@/components/basemap"
import DeckGlOverlay from "@/components/deckgl-overlay"
import OsmPbfFilePicker from "@/components/filepicker"
import { Button } from "@/components/ui/button"
import ObjectToTable from "@/object-to-table"
import { objectToHtmlTableString } from "@/utils"
import { useAtom, useAtomValue, useSetAtom } from "jotai"
import { ArrowLeft, ArrowRight } from "lucide-react"
import type { Osm } from "osm.ts"
import { useEffect } from "react"
import {
	fileAtomFamily,
	osmAtomFamily,
	patchesAtom,
	patchIndexAtom,
	currentWayAtom,
	deckGlLayersAtom,
} from "@/atoms"
import CenterInfo from "@/components/center-info"
import ZoomInfo from "@/components/zoom-info"

function layerIdToName(id: string) {
	if (id === "osm-tk:patch-geojson") return "Patch"
	if (id === "osm-tk:base-geojson") return "Base"
	if (id === "osm-tk:patch-way-geojson") return "Current Way"
	return id
}

const DEFAULT_BASE_PBF_URL = "./pbfs/yakima-full.osm.pbf"
const DEFAULT_PATCH_PBF_URL = "./pbfs/yakima-osw.osm.pbf"

export default function MergePage() {
	const [baseFile, setBaseFile] = useAtom(fileAtomFamily("base"))
	const [patchFile, setPatchFile] = useAtom(fileAtomFamily("patch"))
	const beginMerge = useSetAtom(beginMergeAtom)

	const [patches, setPatches] = useAtom(patchesAtom)
	const [patchIndex, setPatchIndex] = useAtom(patchIndexAtom)
	const map = useAtomValue(mapAtom)
	const deckGlLayers = useAtomValue(deckGlLayersAtom)
	const currentWay = useAtomValue(currentWayAtom)
	const baseNodesNearWay = useAtomValue(baseNodesNearPatchAtom)

	console.log("base nodes", baseNodesNearWay)

	const mergeInProgress = patchIndex >= 0

	useEffect(() => {
		if (map && currentWay) {
			map.fitBounds(currentWay.bbox, {
				padding: 100,
				maxDuration: 200,
				maxZoom: 19,
			})
		}
	}, [map, currentWay])

	// Auto load default files for faster testing
	useEffect(() => {
		if (process.env.NODE_ENV !== "development") return
		if (!baseFile && !patchFile) {
			fetch(DEFAULT_BASE_PBF_URL)
				.then((res) => res.blob())
				.then((blob) => {
					setBaseFile(new File([blob], "yakima-full.osm.pbf"))
				})
			fetch(DEFAULT_PATCH_PBF_URL)
				.then((res) => res.blob())
				.then((blob) => {
					setPatchFile(new File([blob], "yakima-osw.osm.pbf"))
					beginMerge()
				})
		}
	}, [baseFile, patchFile, setBaseFile, setPatchFile, beginMerge])

	return (
		<div className="h-dvh w-dvw flex flex-col">
			<div className="border-b flex flex-row justify-between items-center">
				<h1 className="py-2 px-4">OSM Merge</h1>
				<div className="flex flex-row gap-2 items-center px-4">
					<div className="border-r pr-2">
						<CenterInfo />
					</div>
					<div>
						<ZoomInfo />z
					</div>
				</div>
			</div>
			<div className="flex flex-row grow-1">
				<div className="flex flex-col w-96 gap-4 pt-4">
					<OsmFilePicker />
					{!mergeInProgress && (
						<Button className="mx-4" onClick={() => beginMerge()}>
							Begin Merge
						</Button>
					)}
					{mergeInProgress && currentWay && (
						<div className="flex flex-col gap-2 px-4">
							<Button>Download Merged OSM</Button>

							<div className="flex flex-row justify-between items-center">
								<h3>Verify Patches</h3>
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
										Patch {patchIndex + 1} / {patches.length}
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
							<h3>Type: {patches[patchIndex].type}</h3>
							<h3>Way ID: {currentWay.id}</h3>
							<div>Nodes: {currentWay.refs.length}</div>
							<div className="flex flex-col">
								<h3 className="border-t border-l border-r px-2 py-1">Tags</h3>
								<table>
									<ObjectToTable object={currentWay.tags} />
								</table>
							</div>
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
	const [baseFile, setBaseFile] = useAtom(fileAtomFamily("base"))
	const [patchFile, setPatchFile] = useAtom(fileAtomFamily("patch"))
	const baseOsm = useAtomValue(osmAtomFamily("base"))
	const patchOsm = useAtomValue(osmAtomFamily("patch"))
	const mergeInProgress = useAtomValue(patchIndexAtom) >= 0
	return (
		<div className="flex flex-col gap-2 px-4">
			<div className="flex flex-col gap-1">
				<h3>Base: {baseFile?.name}</h3>
				{!mergeInProgress && (
					<OsmPbfFilePicker file={baseFile} setFile={setBaseFile} />
				)}
				<OsmInfoTable osm={baseOsm} />
			</div>
			<div className="flex flex-col gap-1">
				<h3>Patch: {patchFile?.name}</h3>
				{!mergeInProgress && (
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
