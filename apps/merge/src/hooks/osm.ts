import { useAtom, useSetAtom } from "jotai"
import { showSaveFilePickerWithFallback } from "../lib/save-file-picker"
import type { OsmFileType, OsmInfo } from "osmix"
import { useEffectEvent, useRef } from "react"
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

export class LoadCancelledError extends Error {
	constructor() {
		super("OSM file loading was cancelled")
		this.name = "LoadCancelledError"
	}
}

export type UseOsmFileReturn = ReturnType<typeof useOsmFile>

function isStreamCloneable(stream: WritableStream<Uint8Array>): boolean {
	const { port1, port2 } = new MessageChannel()
	try {
		port1.postMessage(stream)
		return true
	} catch {
		return false
	} finally {
		port1.close()
		port2.close()
	}
}

export function useOsmFile(osmKey: string) {
	const [file, setFile] = useAtom(osmFileAtomFamily(osmKey))
	const [fileInfo, setFileInfo] = useAtom(osmFileInfoAtomFamily(osmKey))
	const [osm, setOsm] = useAtom(osmAtomFamily(osmKey))
	const [osmInfo, setOsmInfo] = useAtom(osmInfoAtomFamily(osmKey))
	const [isStored, setIsStored] = useAtom(osmStoredAtomFamily(osmKey))
	const setSelectedOsm = useSetAtom(selectedOsmAtom)

	// Track current load to prevent stale cancellations from clearing newer load state
	const currentLoadIdRef = useRef(0)

	const loadOsmFile = useEffectEvent(
		async (file: File | null, fileType?: OsmFileType, signal?: AbortSignal) => {
			const loadId = ++currentLoadIdRef.current
			setFile(file)
			setOsm(null)
			setFileInfo(null)
			setIsStored(false)
			if (file == null) return null
			const taskLog = Log.startTask(`Processing file ${file.name}...`)
			try {
				// Check cancellation before starting
				if (signal?.aborted) throw new LoadCancelledError()

				// Hash the file in the worker to avoid blocking UI
				taskLog.update("Hashing file...")
				const buffer = await file.arrayBuffer()

				// Check after file read
				if (signal?.aborted) throw new LoadCancelledError()

				const fileHash = await osmWorker.hashBuffer(buffer)

				// Check after hashing
				if (signal?.aborted) throw new LoadCancelledError()

				const storedFileInfo: StoredFileInfo = {
					fileHash,
					fileName: file.name,
					fileSize: file.size,
				}
				setFileInfo(storedFileInfo)

				// Check if we already have this file stored (in worker)
				const existing = await osmWorker.findByHash(fileHash)

				// Check after cache lookup
				if (signal?.aborted) throw new LoadCancelledError()

				if (existing) {
					taskLog.update("Found cached version, loading from storage...")
					const stored = await osmWorker.loadFromStorage(existing.fileHash)

					// Check after loading from storage
					if (signal?.aborted) throw new LoadCancelledError()

					if (stored) {
						// Get the Osm instance from worker (already has spatial indexes built)
						const osm = await osmWorker.get(stored.entry.fileHash)

						// Final check before setting state
						if (signal?.aborted) throw new LoadCancelledError()

						setOsmInfo(stored.info)
						setOsm(osm)
						setSelectedOsm(osm)
						setIsStored(true)

						taskLog.end(`${file.name} loaded from cache.`)
						return stored.info
					}
				}

				// Parse the file normally in the worker with explicit file type
				taskLog.update("Parsing file...")
				const osmInfo: OsmInfo = await osmWorker.fromFile(
					file,
					{ id: fileHash },
					fileType,
				)

				// Check after parsing
				if (signal?.aborted) throw new LoadCancelledError()

				setOsmInfo(osmInfo)
				const osm = await osmWorker.get(osmInfo.id)

				// Final check before setting state
				if (signal?.aborted) throw new LoadCancelledError()

				setOsm(osm)
				setSelectedOsm(osm)

				taskLog.end(`${file.name} loaded.`)
				return osmInfo
			} catch (e) {
				if (e instanceof LoadCancelledError) {
					// Only reset state if this is still the current load
					// (prevents stale cancellations from clearing newer load state)
					if (loadId === currentLoadIdRef.current) {
						setFile(null)
						setFileInfo(null)
						setOsm(null)
						setOsmInfo(null)
						setIsStored(false)
					}
					taskLog.end(`${file.name} loading cancelled.`)
					return null
				}
				console.error(e)
				taskLog.end(`${file.name} failed to load.`, "error")
				throw e
			}
		},
	)

	const loadFromStorage = useEffectEvent(
		async (storageId: string, signal?: AbortSignal) => {
			const loadId = ++currentLoadIdRef.current
			const taskLog = Log.startTask("Loading osm from storage...")
			try {
				// Check cancellation before starting
				if (signal?.aborted) throw new LoadCancelledError()

				// Load from IndexedDB in the worker
				const stored = await osmWorker.loadFromStorage(storageId)

				// Check after loading from storage
				if (signal?.aborted) throw new LoadCancelledError()

				if (!stored) {
					taskLog.end(`Osm for ${storageId} not found in storage.`, "error")
					return null
				}

				// Get the Osm instance from worker (already has spatial indexes built)
				// Worker registers under fileHash, so use that as the ID
				const osm = await osmWorker.get(stored.entry.fileHash)

				// Final check before setting state
				if (signal?.aborted) throw new LoadCancelledError()

				// Update osmInfo.id to match the storage key (fileHash) since that's where
				// the worker has it registered. This ensures downloadOsm and other calls
				// that use osmInfo.id will find the correct worker entry.
				const osmInfo: OsmInfo = { ...stored.info, id: stored.entry.fileHash }
				setOsmInfo(osmInfo)
				setOsm(osm)
				setSelectedOsm(osm)
				setIsStored(true)

				// Restore file info from storage (clear actual file since we loaded from storage)
				setFile(null)
				setFileInfo(stored.entry)

				taskLog.end(`${stored.entry.fileName} loaded from storage.`)
				return osmInfo
			} catch (e) {
				if (e instanceof LoadCancelledError) {
					// Only reset state if this is still the current load
					// (prevents stale cancellations from clearing newer load state)
					if (loadId === currentLoadIdRef.current) {
						setFile(null)
						setFileInfo(null)
						setOsm(null)
						setOsmInfo(null)
						setIsStored(false)
					}
					taskLog.end("Loading from storage cancelled.")
					return null
				}
				console.error(e)
				taskLog.end(`Failed to load ${storageId} from storage.`, "error")
				throw e
			}
		},
	)

	const downloadOsm = useEffectEvent(async (name?: string) => {
		if (!osmInfo) return
		const task = Log.startTask("Generating OSM file to download")
		const fallbackName = osmInfo.id.endsWith(".pbf") ? osmInfo.id : `${osmInfo.id}.pbf`
		const sourceName = fileInfo?.fileName ?? fallbackName
		const withPrefix = sourceName.startsWith("osmix-") ? sourceName : `osmix-${sourceName}`
		const suggestedName = name ?? withPrefix
		const fileHandle = await showSaveFilePickerWithFallback(
			{
				suggestedName,
				types: [
					{
						description: "OSM PBF",
						accept: { "application/x-protobuf": [".pbf"] },
					},
				],
			},
			() => {
				task.update(
					"Native save picker unavailable, falling back to browser download",
				)
			},
		)
		const stream = await fileHandle.createWritable()
		if (isStreamCloneable(stream)) {
			await osmWorker.toPbf(osmInfo.id, stream)
		} else {
			task.update(
				"Stream transfer unsupported in this browser; using buffered download fallback",
			)
			const data = await osmWorker.toPbfData(osmInfo.id)
			await stream.write(data)
			await stream.close()
		}
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
	 * Copy all state from another useOsmFile instance.
	 * Used to transfer patch to base when base is cleared.
	 */
	const copyStateFrom = useEffectEvent(
		(source: {
			file: File | null
			fileInfo: StoredFileInfo | null
			osm: ReturnType<typeof useOsmFile>["osm"]
			osmInfo: ReturnType<typeof useOsmFile>["osmInfo"]
			isStored: boolean
		}) => {
			setFile(source.file)
			setFileInfo(source.fileInfo)
			setOsm(source.osm)
			setOsmInfo(source.osmInfo)
			setIsStored(source.isStored)
			setSelectedOsm(source.osm)
		},
	)

	/**
	 * Update the osm state with a newly generated/merged result.
	 * Creates new file info with unique hash and name, resets stored state.
	 * If the content hasn't changed (same content hash as original), keeps original file info.
	 */
	const setMergedOsm = useEffectEvent(async (newOsmId: string, mergedFileName?: string) => {
		// Get the new Osm instance from the worker
		const newOsm = await osmWorker.get(newOsmId)
		const newOsmInfo = newOsm.info()

		// Check if anything actually changed using isEqual
		if (newOsm.isEqual(osm) && fileInfo) {
			// No changes - keep the original file info and stored state
			setOsm(newOsm)
			setOsmInfo(newOsmInfo)
			setSelectedOsm(newOsm)
			return newOsm
		}

		// Generate a new file name based on merge context (fallback to timestamp)
		const timestamp = new Date().toISOString().slice(0, 19).replace(/[:]/g, "-")
		const newFileName = mergedFileName ?? `osmix-merged-${timestamp}.pbf`

		// File size is estimated from entity counts (will be accurate after serialization)
		const estimatedSize =
			newOsmInfo.stats.nodes * 20 +
			newOsmInfo.stats.ways * 100 +
			newOsmInfo.stats.relations * 200

		// Use content hash as the new ID to keep worker ID and storage key in sync
		const newFileHash = newOsm.contentHash()
		const newFileInfo: StoredFileInfo = {
			fileHash: newFileHash,
			fileName: newFileName,
			fileSize: estimatedSize,
		}

		// Re-register the Osm in the worker under the new fileHash so that
		// downloadOsm, storeCurrentOsm, and other calls that use osmInfo.id
		// will find the correct worker entry after saving/loading from storage.
		if (newOsmId !== newFileHash) {
			await osmWorker.rename(newOsmId, newFileHash)
		}

		// Update osmInfo.id to match the new fileHash (worker registration key)
		const updatedOsmInfo = { ...newOsmInfo, id: newFileHash }

		// Update all state
		setFile(null) // No actual File object for merged results
		setFileInfo(newFileInfo)
		setOsm(newOsm)
		setOsmInfo(updatedOsmInfo)
		setIsStored(false) // New file, not stored yet
		setSelectedOsm(newOsm)

		return newOsm
	})

	return {
		copyStateFrom,
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
