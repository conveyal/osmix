import { useAtom, useSetAtom } from "jotai"
import { showSaveFilePicker } from "native-file-system-adapter"
import { useCallback } from "react"
import type { StoredFileInfo } from "../lib/osm-storage"
import { Log } from "../state/log"
import {
	osmAtomFamily,
	osmFileAtomFamily,
	osmFileInfoAtomFamily,
	osmInfoAtomFamily,
	selectedOsmAtom,
} from "../state/osm"
import { osmWorker } from "../state/worker"

export function useOsmFile(osmKey: string) {
	const [file, setFile] = useAtom(osmFileAtomFamily(osmKey))
	const [fileInfo, setFileInfo] = useAtom(osmFileInfoAtomFamily(osmKey))
	const [osm, setOsm] = useAtom(osmAtomFamily(osmKey))
	const [osmInfo, setOsmInfo] = useAtom(osmInfoAtomFamily(osmKey))
	const setSelectedOsm = useSetAtom(selectedOsmAtom)

	const loadOsmFile = useCallback(
		async (file: File | null) => {
			setFile(file)
			setOsm(null)
			setFileInfo(null)
			if (file == null) return null
			const taskLog = Log.startTask(`Processing file ${file.name}...`)
			try {
				// Hash the file in the worker to avoid blocking UI
				taskLog.update("Hashing file...")
				const buffer = await file.arrayBuffer()
				const fileHash = await osmWorker.hashBuffer(buffer)
				const storedFileInfo: StoredFileInfo = {
					fileHash,
					fileName: file.name,
					fileSize: file.size,
				}
				setFileInfo(storedFileInfo)

				// Check if we already have this file stored (in worker)
				const existing = await osmWorker.findByHash(fileHash)
				if (existing) {
					taskLog.update("Found cached version, loading from storage...")
					const stored = await osmWorker.loadFromStorage(existing.fileHash)
					if (stored) {
						// Get the Osm instance from worker (already has spatial indexes built)
						const osm = await osmWorker.get(stored.entry.fileHash)
						setOsmInfo(stored.info)
						setOsm(osm)
						setSelectedOsm(osm)

						taskLog.end(`${file.name} loaded from cache.`)
						return stored.info
					}
				}

				// Parse the file normally in the worker
				taskLog.update("Parsing file...")
				const osmInfo = await osmWorker.fromFile(file, { id: fileHash })
				setOsmInfo(osmInfo)
				const osm = await osmWorker.get(osmInfo.id)
				setOsm(osm)
				setSelectedOsm(osm)

				// Store to IndexedDB in the worker (no UI blocking)
				taskLog.update("Storing to IndexedDB...")
				await osmWorker.storeCurrentOsm(osmInfo.id, storedFileInfo)

				taskLog.end(`${file.name} fully loaded and stored.`)
				return osmInfo
			} catch (e) {
				console.error(e)
				taskLog.end(`${file.name} failed to load.`, "error")
				throw e
			}
		},
		[setFile, setFileInfo, setOsm, setSelectedOsm, setOsmInfo],
	)

	const loadFromStorage = useCallback(
		async (storageId: string) => {
			const taskLog = Log.startTask("Loading osm from storage...")
			try {
				// Load from IndexedDB in the worker
				const stored = await osmWorker.loadFromStorage(storageId)
				if (!stored) {
					taskLog.end(`Osm for ${storageId} not found in storage.`, "error")
					return null
				}

				// Get the Osm instance from worker (already has spatial indexes built)
				const osm = await osmWorker.get(stored.entry.fileHash)
				setOsmInfo(stored.info)
				setOsm(osm)
				setSelectedOsm(osm)

				// Restore file info from storage (clear actual file since we loaded from storage)
				setFile(null)
				setFileInfo(stored.entry)

				taskLog.end(`${stored.entry.fileName} loaded from storage.`)
				return stored.info
			} catch (e) {
				console.error(e)
				taskLog.end(`Failed to load ${storageId} from storage.`, "error")
				throw e
			}
		},
		[setOsm, setSelectedOsm, setOsmInfo, setFile, setFileInfo],
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

	return {
		downloadOsm,
		file,
		fileInfo,
		loadFromStorage,
		loadOsmFile,
		osm,
		osmInfo,
		setOsm,
	}
}
