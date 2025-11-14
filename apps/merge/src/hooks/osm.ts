import { Osm } from "@osmix/core"
import * as Comlink from "comlink"
import { useAtom } from "jotai"
import { showSaveFilePicker } from "native-file-system-adapter"
import { osmToPbfStream } from "osmix"
import { useCallback, useEffect, useState, useTransition } from "react"
import { Log } from "../state/log"
import { osmAtomFamily, osmFileAtomFamily } from "../state/osm"
import { osmWorker } from "../state/worker"
import { supportsReadableStreamTransfer } from "../utils"
import { useMap } from "./map"

function useOsmDefaultFile(
	loadOsmFile: (file: File | null) => Promise<Osm | undefined>,
	defaultFilePath?: string,
) {
	const [, startTransition] = useTransition()
	const [loadOnStart, setLoadOnStart] = useState(import.meta.env.DEV)
	const map = useMap()
	useEffect(() => {
		if (!loadOnStart || !defaultFilePath || map == null) return
		setLoadOnStart(false)
		console.warn("LOADING DEFAULT FILE", defaultFilePath)
		startTransition(async () => {
			const response = await fetch(defaultFilePath)
			const blob = await response.blob()
			const osm = await loadOsmFile(new File([blob], defaultFilePath))
			const bbox = osm?.bbox()
			if (bbox) {
				map.fitBounds(bbox, {
					padding: 100,
					maxDuration: 200,
				})
			}
		})
	}, [defaultFilePath, loadOsmFile, loadOnStart, map])
}

export function useOsmFile(id: string, defaultFilePath?: string) {
	const [file, setFile] = useAtom(osmFileAtomFamily(id))
	const [osm, setOsm] = useAtom(osmAtomFamily(id))

	const loadOsmFile = useCallback(
		async (file: File | null) => {
			setFile(file)
			setOsm(null)
			if (file == null) return
			const taskLog = Log.startTask(`Processing file ${file.name}...`)
			try {
				const data = supportsReadableStreamTransfer()
					? file.stream()
					: await file.arrayBuffer()

				// Detect file type based on extension
				const fileName = file.name.toLowerCase()
				const isGeoJSON =
					fileName.endsWith(".geojson") || fileName.endsWith(".json")

				const osmBuffers = isGeoJSON
					? await osmWorker.fromGeoJSON(
							id ?? file.name,
							Comlink.transfer(data, [data]),
						)
					: await osmWorker.fromPbf(
							id ?? file.name,
							Comlink.transfer(data, [data]),
						)

				const osm = new Osm(osmBuffers)
				setOsm(osm)
				taskLog.end(`${file.name} fully loaded.`)
				return osm
			} catch (e) {
				console.error(e)
				taskLog.end(`${file.name} failed to load.`, "error")
				throw e
			}
		},
		[id, setFile, setOsm],
	)

	const downloadOsm = useCallback(
		async (name?: string) => {
			if (!osm) return
			const task = Log.startTask("Generating OSM file to download")
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
			await osmToPbfStream(osm).pipeTo(stream)
			task.end(`Created ${fileHandle.name} PBF for download`)
		},
		[osm],
	)

	// Load a default file in development mode
	useOsmDefaultFile(loadOsmFile, defaultFilePath)

	return { downloadOsm, file, loadOsmFile, osm, setOsm }
}
