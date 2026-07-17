/**
 * Utilities for checking browser storage availability.
 */

export interface StorageCheck {
  canStore: boolean;
  availableBytes: number;
  requiredBytes: number;
}

/**
 * Check whether the remaining quota can hold the exact storable-transfer bytes.
 */
export async function canStoreBytes(requiredBytes: number): Promise<StorageCheck> {
  const estimate = await navigator.storage.estimate();
  const available = (estimate.quota ?? 0) - (estimate.usage ?? 0);
  return {
    canStore: available >= requiredBytes,
    availableBytes: available,
    requiredBytes,
  };
}
