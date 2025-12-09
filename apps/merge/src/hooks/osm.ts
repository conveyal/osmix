import type { OsmInfo } from "@osmix/core"
import { useAtom } from "jotai"
import { showSaveFilePicker } from "native-file-system-adapter"
import { useCallback, useEffect, useState, useTransition } from "react"
import { Log } from "../state/log"
import {
	osmAtomFamily,
	osmFileAtomFamily,
	osmInfoAtomFamily,
} from "../state/osm"
import { osmWorker } from "../state/worker"
import { useMap } from "./map"

function useOsmDefaultFile(
	loadOsmFile: (file: File | null) => Promise<OsmInfo | undefined>,
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
			const osmInfo = await loadOsmFile(new File([blob], defaultFilePath))
			if (osmInfo?.bbox) {
				map.fitBounds(osmInfo.bbox, {
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
	const [osmInfo, setOsmInfo] = useAtom(osmInfoAtomFamily(id))

	const loadOsmFile = useCallback(
		async (file: File | null) => {
			setFile(file)
			setOsm(null)
			if (file == null) return
			const taskLog = Log.startTask(`Processing file ${file.name}...`)
			try {
				const osmInfo = await osmWorker.fromFile(file, { id })
				setOsmInfo(osmInfo)
				const osm = await osmWorker.get(osmInfo.id)
				setOsm(osm)
				taskLog.end(`${file.name} fully loaded.`)
				return osmInfo
			} catch (e) {
				console.error(e)
				taskLog.end(`${file.name} failed to load.`, "error")
				throw e
			}
		},
		[setFile, setOsm, setOsmInfo, id],
	)

	const downloadOsm = useCallback(
		async (name?: string) => {
			if (!osmInfo) return
			const task = Log.startTask("Generating OSM file to download")
			const suggestedName =
				name ?? (osmInfo.id.endsWith(".pbf") ? osmInfo.id : `${osmInfo.id}.pbf`)
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
			await osmWorker.toPbf(osmInfo.id, stream)
			task.end(`Created ${fileHandle.name} PBF for download`)
		},
		[osmInfo],
	)

	// Load a default file in development mode
	useOsmDefaultFile(loadOsmFile, defaultFilePath)

	return { downloadOsm, file, loadOsmFile, osm, osmInfo, setOsm }
}
