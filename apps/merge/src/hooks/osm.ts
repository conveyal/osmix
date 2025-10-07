import { Osmix, writeOsmToPbfStream } from "@osmix/core"
import * as Comlink from "comlink"
import { useAtom, useAtomValue } from "jotai"
import { showSaveFilePicker } from "native-file-system-adapter"
import { useCallback, useEffect, useState, useTransition } from "react"
import { Log } from "@/state/log"
import { mapAtom } from "@/state/map"
import { osmAtomFamily, osmFileAtomFamily } from "@/state/osm"
import { osmWorker } from "@/state/worker"
import { supportsReadableStreamTransfer } from "@/utils"

function useOsmDefaultFile(
	loadOsmFile: (file: File | null) => Promise<Osmix | undefined>,
	defaultFilePath?: string,
) {
	const [, startTransition] = useTransition()
	const [loadOnStart, setLoadOnStart] = useState(
		process.env.NODE_ENV === "development",
	)
	const map = useAtomValue(mapAtom)
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
				const osmBuffers = await osmWorker.fromPbf(
					id ?? file.name,
					Comlink.transfer(data, [data]),
				)
				const osm = Osmix.from(osmBuffers)
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
			await writeOsmToPbfStream(osm, stream)
			task.end(`Created ${fileHandle.name} PBF for download`)
		},
		[osm],
	)

	// Load a default file in development mode
	useOsmDefaultFile(loadOsmFile, defaultFilePath)

	return { downloadOsm, file, loadOsmFile, osm, setOsm }
}
