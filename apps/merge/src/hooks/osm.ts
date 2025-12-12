import { Osm, type OsmInfo } from "@osmix/core"
import { useAtom, useSetAtom } from "jotai"
import { showSaveFilePicker } from "native-file-system-adapter"
import { useCallback, useEffect, useState, useTransition } from "react"
import { loadStoredOsm, storeOsm } from "../lib/osm-storage"
import { Log } from "../state/log"
import {
	osmAtomFamily,
	osmFileAtomFamily,
	osmInfoAtomFamily,
	selectedOsmAtom,
} from "../state/osm"
import { storedOsmEntriesAtom } from "../state/storage"
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
	const setSelectedOsm = useSetAtom(selectedOsmAtom)
	const refreshStoredEntries = useSetAtom(storedOsmEntriesAtom)

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
				setSelectedOsm(osm)

				// Auto-store to IndexedDB
				taskLog.update("Storing to IndexedDB...")
				const transferables = osm.transferables()
				await storeOsm(osmInfo, transferables)
				refreshStoredEntries()

				taskLog.end(`${file.name} fully loaded and stored.`)
				return osmInfo
			} catch (e) {
				console.error(e)
				taskLog.end(`${file.name} failed to load.`, "error")
				throw e
			}
		},
		[setFile, setOsm, setSelectedOsm, setOsmInfo, id, refreshStoredEntries],
	)

	const loadFromStorage = useCallback(
		async (storageId: string) => {
			const taskLog = Log.startTask(`Loading ${storageId} from storage...`)
			try {
				const stored = await loadStoredOsm(storageId)
				if (!stored) {
					taskLog.end(`${storageId} not found in storage.`, "error")
					return null
				}

				// Reconstruct Osm from stored transferables and transfer to workers
				const osm = new Osm(stored.transferables)
				await osmWorker.transferIn(osm)
				setOsmInfo(stored.info)
				setOsm(osm)
				setSelectedOsm(osm)

				taskLog.end(`${storageId} loaded from storage.`)
				return stored.info
			} catch (e) {
				console.error(e)
				taskLog.end(`Failed to load ${storageId} from storage.`, "error")
				throw e
			}
		},
		[setOsm, setSelectedOsm, setOsmInfo],
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

	return {
		downloadOsm,
		file,
		loadFromStorage,
		loadOsmFile,
		osm,
		osmInfo,
		setOsm,
	}
}
