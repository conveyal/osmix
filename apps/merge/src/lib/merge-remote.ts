/**
 * Extended OsmixRemote with IndexedDB storage capabilities.
 *
 * Provides a clean API for storage operations by wrapping the MergeWorker
 * methods, following the same pattern as the base OsmixRemote class.
 */

import type { Remote } from "comlink";
import type { OsmFromPbfOptions, Progress } from "osmix";
import {
  getOsmixCapabilities,
  type OsmId,
  type OsmInfo,
  OsmixRemote,
  selectWorkerCount,
  transfer,
} from "osmix";

import type {
  MergeWorker,
  PbfUrlLoadResult,
  StoredFileInfo,
  StoredOsmEntry,
} from "../workers/osm.worker";
// oxlint-disable-next-line import/default -- Vite ?worker&url resolves to a string URL
import OsmWorkerUrl from "../workers/osm.worker.ts?worker&url";

export interface MergeRemoteOptions {
  workerCount?: number;
  onProgress?: (progress: Progress) => void;
}

/**
 * Create a new MergeRemote instance with initialized worker pool.
 *
 * @example
 * const remote = await createMergeRemote({
 *   onProgress: (progress) => console.log(progress.msg),
 * })
 * const hash = await remote.hashBuffer(buffer)
 */
export async function createMergeRemote(options: MergeRemoteOptions = {}): Promise<MergeRemote> {
  const remote = new MergeRemote();
  const hardwareConcurrency = typeof navigator === "undefined" ? 1 : navigator.hardwareConcurrency;
  const defaultWorkerCount = getOsmixCapabilities().canShareArrayBuffers
    ? selectWorkerCount({ hardwareConcurrency, reserveCores: 1, maxWorkers: 4 })
    : 1;
  await remote.initializeWorkerPool(
    options.workerCount ?? defaultWorkerCount,
    new URL(OsmWorkerUrl, import.meta.url),
    options.onProgress,
  );
  return remote;
}

/**
 * Extended OsmixRemote with storage capabilities.
 *
 * Wraps MergeWorker storage methods to provide a consistent API
 * that follows the OsmixRemote pattern. All storage operations
 * are delegated to workers to keep the main thread responsive.
 */
export class MergeRemote extends OsmixRemote<MergeWorker> {
  private readonly storageRecoveryIds = new Map<string, string>();

  /**
   * Compute SHA-256 hash of an ArrayBuffer in a worker.
   * Returns the hash as a hex string.
   */
  hashBuffer(data: ArrayBuffer, signal?: AbortSignal): Promise<string> {
    return this.runWithWorker((worker) => worker.hashBuffer(data), {
      lane: "compute",
      retry: "once",
      signal,
    });
  }

  /** Hash a File incrementally in the worker. */
  hashFile(file: File, taskId?: string, signal?: AbortSignal): Promise<string> {
    return this.runWithWorker((worker) => worker.hashFile(file, taskId), {
      lane: "control",
      retry: "once",
      signal,
    });
  }

  /** Hash a transferred byte stream incrementally in the worker. */
  hashStream(
    stream: ReadableStream<Uint8Array>,
    taskId?: string,
    signal?: AbortSignal,
  ): Promise<string> {
    return this.runWithWorker((worker) => worker.hashStream(transfer(stream), taskId), {
      lane: "control",
      retry: "never",
      signal,
    });
  }

  /** Cancel a hash by its caller-supplied task ID. */
  cancelHash(taskId: string): void {
    const controlWorker = this.workerIndexes()[0];
    if (controlWorker === undefined) return;
    this.notifyWorkers((worker) => worker.cancelHash(taskId), [controlWorker]);
  }

  /** Exact buffer payload that would be written to IndexedDB for a dataset. */
  getStorableByteLength(osmId: string): Promise<number> {
    return this.runWithWorker((worker) => worker.getStorableByteLength(this.getId(osmId)), {
      lane: "control",
      retry: "once",
    });
  }

  /** Fetch, hash, and parse a PBF once without materializing a browser File. */
  async fromPbfUrl(
    url: string,
    options: Partial<OsmFromPbfOptions> = {},
    signal?: AbortSignal,
  ): Promise<PbfUrlLoadResult> {
    return this.runWithWorker(
      async (worker) => {
        const result = await worker.fromPbfUrl({ url, options });
        await this.populateOtherWorkers(worker, result.info.id);
        return result;
      },
      { lane: "control", retry: "never", signal },
    );
  }

  /**
   * Find a stored entry by file hash.
   * Returns the stored entry metadata if found, null otherwise.
   */
  findByHash(hash: string, signal?: AbortSignal): Promise<StoredOsmEntry | null> {
    return this.runWithWorker((worker) => worker.findByHash(hash), {
      lane: "control",
      retry: "once",
      signal,
    });
  }

  /**
   * Store the currently-loaded Osm instance to IndexedDB.
   * The Osm must already be loaded in the worker (via fromPbf, etc.).
   */
  async storeCurrentOsm(osmId: OsmId, fileInfo: StoredFileInfo): Promise<void> {
    const id = this.getId(osmId);
    await this.runWithWorker((worker) => worker.storeCurrentOsm(id, fileInfo), {
      lane: "control",
      retry: "never",
    });
    this.storageRecoveryIds.set(id, fileInfo.fileHash);
    this.registerDatasetForRecovery(id);
  }

  /**
   * Load an Osm from IndexedDB by storage ID and register it in workers.
   * Builds spatial indexes automatically after loading.
   * Returns the entry and info if found, null otherwise.
   */
  async loadFromStorage(
    osmId: OsmId,
    signal?: AbortSignal,
  ): Promise<{
    entry: StoredOsmEntry;
    info: OsmInfo;
  } | null> {
    const storageId = this.getId(osmId);
    const result = await this.runWithWorker(
      async (worker) => {
        const osmEntry = await worker.loadFromStorage(storageId);
        if (!osmEntry) return null;
        await this.populateOtherWorkers(worker, osmEntry.entry.fileHash);
        return osmEntry;
      },
      { lane: "control", retry: "never", signal },
    );
    if (result) {
      this.storageRecoveryIds.set(result.entry.fileHash, storageId);
      this.registerDatasetForRecovery(result.entry.fileHash);
    }
    return result;
  }

  override async delete(osmId: OsmId): Promise<void> {
    this.storageRecoveryIds.delete(this.getId(osmId));
    await super.delete(osmId);
  }

  override async rename(fromId: OsmId, toId: string): Promise<void> {
    const from = this.getId(fromId);
    const storageId = this.storageRecoveryIds.get(from);
    this.storageRecoveryIds.delete(from);
    if (storageId) this.storageRecoveryIds.set(toId, storageId);
    await super.rename(from, toId);
  }

  protected override async recoverDataset(
    worker: Remote<MergeWorker>,
    datasetId: string,
  ): Promise<boolean> {
    const storageId = this.storageRecoveryIds.get(datasetId);
    if (!storageId) return false;
    // Recovery is a read-only IndexedDB replay. It must not update access metadata.
    await worker.loadFromStorage(storageId, false, datasetId);
    return worker.has(datasetId);
  }

  /**
   * Get all stored Osm entries (metadata only).
   */
  listStoredOsm(): Promise<StoredOsmEntry[]> {
    return this.runWithWorker((worker) => worker.listStoredOsm(), {
      lane: "control",
      retry: "once",
    });
  }

  /**
   * Delete a stored Osm entry from IndexedDB.
   */
  deleteStoredOsm(id: string): Promise<void> {
    return this.runWithWorker((worker) => worker.deleteStoredOsm(id), {
      lane: "control",
      retry: "never",
    }).then(async () => {
      this.storageRecoveryIds.delete(id);
      await super.delete(id);
    });
  }

  /**
   * Rename a stored Osm entry in IndexedDB.
   */
  renameStoredOsm(id: string, newFileName: string): Promise<void> {
    return this.runWithWorker((worker) => worker.renameStoredOsm(id, newFileName), {
      lane: "control",
      retry: "never",
    });
  }

  /**
   * Get storage statistics.
   */
  getStorageStats(): Promise<{ count: number; estimatedBytes: number }> {
    return this.runWithWorker((worker) => worker.getStorageStats(), {
      lane: "control",
      retry: "once",
    });
  }

  /**
   * Get the most recently accessed stored Osm entry.
   * Returns null if no entries exist.
   */
  getMostRecentlyUsed(): Promise<StoredOsmEntry | null> {
    return this.runWithWorker((worker) => worker.getMostRecentlyUsed(), {
      lane: "control",
      retry: "once",
    });
  }
}
