/**
 * Utilities for checking browser storage availability.
 */

export interface StorageCheck {
	canStore: boolean
	availableBytes: number
	requiredBytes: number
}

/**
 * Check if there is sufficient storage space to save a file.
 * Adds a 10% buffer for serialization overhead.
 */
export async function canStoreFile(fileSize: number): Promise<StorageCheck> {
	const estimate = await navigator.storage.estimate()
	const available = (estimate.quota ?? 0) - (estimate.usage ?? 0)
	// Add 10% buffer for serialization overhead
	const required = Math.ceil(fileSize * 1.1)
	return {
		canStore: available >= required,
		availableBytes: available,
		requiredBytes: required,
	}
}
