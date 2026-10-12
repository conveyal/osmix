import type { Osm, OsmInfo } from "osmix";

import type { StoredFileInfo } from "../workers/osmix-app.worker.ts";

interface MergedOsmWorker {
  get(osmId: string): Promise<Osm>;
  rename(fromId: string, toId: string): Promise<void>;
}

interface PrepareMergedOsmStateOptions {
  currentOsm: Osm | null;
  currentFileInfo: StoredFileInfo | null;
  /** The worker ID for a content hash. Slots use `slotOsmId`; the default is the hash itself. */
  datasetIdFor?: (contentHash: string) => string;
  mergedFileName?: string;
  newOsmId: string;
  now?: Date;
  worker: MergedOsmWorker;
}

export type PreparedMergedOsmState =
  | {
      kind: "unchanged";
      osm: Osm;
      osmInfo: OsmInfo;
    }
  | {
      fileInfo: StoredFileInfo;
      kind: "changed";
      osm: Osm;
      osmInfo: OsmInfo;
    };

/**
 * Resolve a merged dataset to its content-addressed worker ID and refreshed metadata.
 *
 * Renaming a worker dataset re-registers it as a new `Osm` instance. The post-rename
 * lookup is required so callers never retain an object whose ID has been removed from
 * the worker registry.
 */
export async function prepareMergedOsmState({
  currentOsm,
  currentFileInfo,
  datasetIdFor = (contentHash) => contentHash,
  mergedFileName,
  newOsmId,
  now = new Date(),
  worker,
}: PrepareMergedOsmStateOptions): Promise<PreparedMergedOsmState> {
  let retryOsmId = newOsmId;
  try {
    let mergedOsm = await worker.get(newOsmId);
    const initialInfo = mergedOsm.info();

    if (mergedOsm.isEqual(currentOsm) && currentFileInfo) {
      return { kind: "unchanged", osm: mergedOsm, osmInfo: initialInfo };
    }

    const contentHash = mergedOsm.contentHash();
    const datasetId = datasetIdFor(contentHash);
    if (newOsmId !== datasetId) {
      await worker.rename(newOsmId, datasetId);
      retryOsmId = datasetId;
      mergedOsm = await worker.get(datasetId);
    }

    const refreshedInfo = mergedOsm.info();
    const timestamp = now.toISOString().slice(0, 19).replace(/[:]/g, "-");
    const fileName = mergedFileName ?? `osmix-merged-${timestamp}.pbf`;
    const fileInfo: StoredFileInfo = {
      fileHash: contentHash,
      fileName,
      fileSize:
        refreshedInfo.stats.nodes * 20 +
        refreshedInfo.stats.ways * 100 +
        refreshedInfo.stats.relations * 200,
    };

    return {
      fileInfo,
      kind: "changed",
      osm: mergedOsm,
      osmInfo: { ...refreshedInfo, id: datasetId },
    };
  } catch (error) {
    throw Object.assign(
      new Error(
        `Merged dataset refresh failed: ${error instanceof Error ? error.message : "Unknown error"}`,
        { cause: error },
      ),
      { mergedOsmId: retryOsmId },
    );
  }
}

/** A failed post-rename refresh must retry the new worker ID, not the removed input ID. */
export function mergedOsmRefreshRetryId(error: unknown, fallback: string): string {
  return error &&
    typeof error === "object" &&
    "mergedOsmId" in error &&
    typeof error.mergedOsmId === "string" &&
    error.mergedOsmId.length > 0
    ? error.mergedOsmId
    : fallback;
}
