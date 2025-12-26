import { useAtom, useSetAtom } from "jotai"
import { showSaveFilePicker } from "native-file-system-adapter"
import { useEffectEvent } from "react"
import { canStoreFile } from "../lib/storage-utils"
import { Log } from "../state/log"
import {
	osmAtomFamily,
	osmFileAtomFamily,
	osmFileInfoAtomFamily,
	osmInfoAtomFamily,
	osmStoredAtomFamily,
	selectedOsmAtom,
} from "../state/osm"
import { osmWorker } from "../state/worker"
import type { StoredFileInfo } from "../workers/osm.worker"

export function useOsmFile(osmKey: string) {
	const [file, setFile] = useAtom(osmFileAtomFamily(osmKey))
	const [fileInfo, setFileInfo] = useAtom(osmFileInfoAtomFamily(osmKey))
	const [osm, setOsm] = useAtom(osmAtomFamily(osmKey))
	const [osmInfo, setOsmInfo] = useAtom(osmInfoAtomFamily(osmKey))
	const [isStored, setIsStored] = useAtom(osmStoredAtomFamily(osmKey))
	const setSelectedOsm = useSetAtom(selectedOsmAtom)

	const loadOsmFile = useEffectEvent(async (file: File | null) => {
		setFile(file)
		setOsm(null)
		setFileInfo(null)
		setIsStored(false)
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
					setIsStored(true)

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

			taskLog.end(`${file.name} loaded.`)
			return osmInfo
		} catch (e) {
			console.error(e)
			taskLog.end(`${file.name} failed to load.`, "error")
			throw e
		}
	})

	const loadFromStorage = useEffectEvent(async (storageId: string) => {
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
			setIsStored(true)

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
	})

	const downloadOsm = useEffectEvent(async (name?: string) => {
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
	})

	const saveToStorage = useEffectEvent(async () => {
		if (!osmInfo || !fileInfo || isStored) return

		// Check storage availability
		const storageCheck = await canStoreFile(fileInfo.fileSize)
		if (!storageCheck.canStore) {
			Log.addMessage(
				`Insufficient storage: need ${Math.ceil(storageCheck.requiredBytes / 1024 / 1024)}MB, ` +
					`have ${Math.ceil(storageCheck.availableBytes / 1024 / 1024)}MB available`,
				"error",
			)
			return
		}

		const task = Log.startTask("Saving to storage...")
		try {
			await osmWorker.storeCurrentOsm(osmInfo.id, fileInfo)
			setIsStored(true)
			task.end(`${fileInfo.fileName} saved to storage.`)
		} catch (e) {
			console.error(e)
			task.end("Failed to save to storage.", "error")
			throw e
		}
	})

	/**
	 * Update the osm state with a newly generated/merged result.
	 * Creates new file info with unique hash and name, resets stored state.
	 * If the content hasn't changed (same content hash as original), keeps original file info.
	 */
	const setMergedOsm = useEffectEvent(async (newOsmId: string) => {
		// Get the new Osm instance from the worker
		const newOsm = await osmWorker.get(newOsmId)
		const newOsmInfo = newOsm.info()

		// Generate content hash from the actual data
		const newContentHash = newOsm.contentHash()

		// Check if anything actually changed by comparing content hashes
		const originalContentHash = osm?.contentHash()
		const hasChanges =
			!originalContentHash || originalContentHash !== newContentHash

		if (!hasChanges && fileInfo) {
			// No changes - keep the original file info and stored state
			setOsm(newOsm)
			setOsmInfo(newOsmInfo)
			setSelectedOsm(newOsm)
			return newOsm
		}

		// Generate a new file name based on the base name or timestamp
		const timestamp = new Date().toISOString().slice(0, 19).replace(/[:]/g, "-")
		const newFileName = `merged-${timestamp}.pbf`

		// File size is estimated from entity counts (will be accurate after serialization)
		const estimatedSize =
			newOsmInfo.stats.nodes * 20 +
			newOsmInfo.stats.ways * 100 +
			newOsmInfo.stats.relations * 200
		const newFileInfo: StoredFileInfo = {
			fileHash: newContentHash,
			fileName: newFileName,
			fileSize: estimatedSize,
		}

		// Update all state
		setFile(null) // No actual File object for merged results
		setFileInfo(newFileInfo)
		setOsm(newOsm)
		setOsmInfo(newOsmInfo)
		setIsStored(false) // New file, not stored yet
		setSelectedOsm(newOsm)

		return newOsm
	})

	return {
		downloadOsm,
		file,
		fileInfo,
		isStored,
		loadFromStorage,
		loadOsmFile,
		osm,
		osmInfo,
		saveToStorage,
		setMergedOsm,
		setOsm,
	}
}
