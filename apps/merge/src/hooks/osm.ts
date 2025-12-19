import { Osm } from "@osmix/core"
import { useAtom, useSetAtom } from "jotai"
import { showSaveFilePicker } from "native-file-system-adapter"
import { useCallback } from "react"
import { hashFile, osmStorage } from "../lib/osm-storage"
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
				// Hash the file first to check for duplicates
				taskLog.update("Hashing file...")
				const fileHash = await hashFile(file)
				setFileInfo({
					fileHash,
					fileName: file.name,
					fileSize: file.size,
				})

				// Check if we already have this file stored
				const existing = await osmStorage.findByHash(fileHash)
				if (existing) {
					taskLog.update("Found cached version, loading from storage...")
					const stored = await osmStorage.loadStoredOsm(existing.fileHash)
					if (stored) {
						// Load from storage instead of parsing
						const osm = new Osm(stored.transferables)
						// Build spatial indexes
						osm.buildSpatialIndexes()
						await osmWorker.transferIn(osm)
						setOsmInfo(stored.entry.info)
						setOsm(osm)
						setSelectedOsm(osm)

						taskLog.end(`${file.name} loaded from cache.`)
						return stored.entry.info
					}
				}

				// Parse the file normally
				taskLog.update("Parsing file...")
				const osmInfo = await osmWorker.fromFile(file, { id: fileHash })
				setOsmInfo(osmInfo)
				const osm = await osmWorker.get(osmInfo.id)
				setOsm(osm)
				setSelectedOsm(osm)

				// Auto-store to IndexedDB with hash and file info
				taskLog.update("Storing to IndexedDB...")
				const transferables = osm.transferables()
				await osmStorage.storeOsm(osmInfo, transferables, {
					fileHash,
					fileName: file.name,
					fileSize: file.size,
				})

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
				const stored = await osmStorage.loadStoredOsm(storageId)
				if (!stored) {
					taskLog.end(`Osm for ${storageId} not found in storage.`, "error")
					return null
				}

				// Send raw transferables directly to worker
				const osm = new Osm(stored.transferables)
				// Build spatial indexes
				osm.buildSpatialIndexes()
				await osmWorker.transferIn(osm)
				setOsmInfo(stored.entry.info)
				setOsm(osm)
				setSelectedOsm(osm)

				// Restore file info from storage (clear actual file since we loaded from storage)
				setFile(null)
				setFileInfo(stored.entry)

				taskLog.end(`${stored.entry.fileName} loaded from storage.`)
				return stored.entry.info
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
