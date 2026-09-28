import { useAtom, useSetAtom } from "jotai";
import type { GeoBbox2D } from "osmix";
import type {
  ExtractStrategy,
  ExtractTagFilterRules,
  OsmFileType,
  OsmInfo,
  OsmLoadProfile,
} from "osmix";
import { useEffect, useEffectEvent, useRef, useState } from "react";

import { getBrowserLoadCapabilities } from "../lib/browser-capabilities.ts";
import { prepareMergedOsmState } from "../lib/merged-osm-state.ts";
import { describeOsmLoadFailure, type OsmLoadFailureContext } from "../lib/osm-load-failure.ts";
import { ensureOsmPbfDownloadName } from "../lib/osm-pbf-download-name.ts";
import { chooseSaveTarget, downloadBlob } from "../lib/save-file-picker.ts";
import { canStoreBytes } from "../lib/storage-utils.ts";
import type { OsmixAppRemote } from "../remote.ts";
import { osmDatasetVersionAtomFamily } from "../state/osm-version.ts";
import {
  osmAtomFamily,
  osmFileAtomFamily,
  osmFileInfoAtomFamily,
  osmInfoAtomFamily,
  osmLoadFailureAtomFamily,
  osmLoadProfileAtomFamily,
  osmStoredAtomFamily,
} from "../state/osm.ts";
import { Tasks } from "../state/tasks.ts";
import type { StoredFileInfo } from "../workers/osmix-app.worker.ts";
import { useOsmixRemote } from "./remote.ts";

export class LoadCancelledError extends Error {
  constructor() {
    super("OSM file loading was cancelled");
    this.name = "LoadCancelledError";
  }
}

async function hashFileWithCancellation(
  remote: OsmixAppRemote,
  file: File,
  signal?: AbortSignal,
): Promise<string> {
  if (signal?.aborted) throw new LoadCancelledError();
  const taskId = crypto.randomUUID();
  const cancel = () => {
    remote.cancelHash(taskId);
  };
  signal?.addEventListener("abort", cancel, { once: true });
  try {
    return await remote.hashFile(file, taskId, signal);
  } catch (error) {
    if (signal?.aborted) throw new LoadCancelledError();
    throw error;
  } finally {
    signal?.removeEventListener("abort", cancel);
  }
}

async function describeLoadFailure(error: unknown, context: OsmLoadFailureContext) {
  let resolvedContext = context;
  const record =
    typeof error === "object" && error !== null ? (error as Record<string, unknown>) : null;
  const needsBufferCapabilities =
    record?.["code"] === "OSM_ENTITY_INDEX_BUILD_FAILED" ||
    record?.["code"] === "TYPED_BUFFER_ALLOCATION_FAILED";
  if (!resolvedContext.capabilities && needsBufferCapabilities) {
    try {
      resolvedContext = {
        ...resolvedContext,
        capabilities: await getBrowserLoadCapabilities(),
      };
    } catch {
      // The allocation error remains useful when a follow-up capability probe is unavailable.
    }
  }
  return describeOsmLoadFailure(error, resolvedContext);
}

function isPbfFile(file: File, fileType?: OsmFileType): boolean {
  if (fileType !== undefined) return fileType === "pbf";
  return file.name.toLowerCase().endsWith(".pbf");
}

/** A cached dataset satisfies the request unless Full needs a missing all-node index. */
function cachedProfileIsUsable(
  requestedProfile: OsmLoadProfile,
  cachedInfo: OsmInfo | undefined,
): boolean {
  return requestedProfile !== "full" || cachedInfo?.spatialIndexes.nodes.all === true;
}

export type UseOsmFileReturn = ReturnType<typeof useOsmFile>;

export function useOsmFile(osmKey: string) {
  const [file, setFile] = useAtom(osmFileAtomFamily(osmKey));
  const [fileInfo, setFileInfo] = useAtom(osmFileInfoAtomFamily(osmKey));
  const [osm, setOsm] = useAtom(osmAtomFamily(osmKey));
  const [osmInfo, setOsmInfo] = useAtom(osmInfoAtomFamily(osmKey));
  const [isStored, setIsStored] = useAtom(osmStoredAtomFamily(osmKey));
  const [loadProfile, setLoadProfile] = useAtom(osmLoadProfileAtomFamily(osmKey));
  const [loadFailure, setLoadFailure] = useAtom(osmLoadFailureAtomFamily(osmKey));
  const [storageCheckResult, setStorageCheckResult] = useState<{
    osmId: string;
    check: Awaited<ReturnType<typeof canStoreBytes>>;
  } | null>(null);
  const remote = useOsmixRemote();
  const bumpDatasetVersion = useSetAtom(osmDatasetVersionAtomFamily(osmKey));
  /** Announce that the dataset in this slot is being replaced or cleared. */
  const invalidateDataset = () => bumpDatasetVersion((version) => version + 1);

  // Track current load to prevent stale cancellations from clearing newer load state
  const currentLoadIdRef = useRef(0);
  const sourceUrlRef = useRef<string | null>(null);

  useEffect(() => {
    if (isStored || !osmInfo) return;
    let disposed = false;
    void (async () => {
      try {
        const storableBytes =
          osmInfo.loadDiagnostics?.bytes.storageBytes ??
          (await remote.getStorableByteLength(osmInfo.id));
        const check = await canStoreBytes(storableBytes);
        if (!disposed) setStorageCheckResult({ osmId: osmInfo.id, check });
      } catch {
        // The dataset may be replaced while this asynchronous estimate is running.
      }
    })();
    return () => {
      disposed = true;
    };
  }, [isStored, osmInfo, remote]);

  const storageCheck =
    !isStored && storageCheckResult && storageCheckResult.osmId === osmInfo?.id
      ? storageCheckResult.check
      : null;

  const loadOsmFile = useEffectEvent(
    async (
      file: File | null,
      fileType?: OsmFileType,
      controller?: AbortController,
      profileOverride?: OsmLoadProfile,
    ) => {
      const loadId = ++currentLoadIdRef.current;
      invalidateDataset();
      setFile(file);
      sourceUrlRef.current = null;
      setOsm(null);
      setOsmInfo(null);
      setFileInfo(null);
      setIsStored(false);
      setLoadFailure(null);
      if (file == null) return null;
      const signal = controller?.signal;
      const task = Tasks.start(`Open ${file.name}`, { controller });
      let loadCapabilities: Awaited<ReturnType<typeof getBrowserLoadCapabilities>> | undefined;
      try {
        // Check cancellation before starting
        if (signal?.aborted) throw new LoadCancelledError();

        // Hash the file in the worker to avoid blocking UI
        const fileHash = await task.runStep("Hash file", () =>
          hashFileWithCancellation(remote, file, signal),
        );

        // Check after hashing
        if (signal?.aborted) throw new LoadCancelledError();

        const storedFileInfo: StoredFileInfo = {
          fileHash,
          fileName: file.name,
          fileSize: file.size,
        };
        setFileInfo(storedFileInfo);

        // Check if we already have this file stored (in worker)
        const existing = await remote.findByHash(fileHash, signal);

        // Check after cache lookup
        if (signal?.aborted) throw new LoadCancelledError();

        const requestedProfile = profileOverride ?? loadProfile;
        if (existing && cachedProfileIsUsable(requestedProfile, existing.info)) {
          const stored = await task.runStep("Load cached version", async () => {
            const stored = await remote.loadFromStorage(existing.fileHash, signal);
            // Check after loading from storage
            if (signal?.aborted) throw new LoadCancelledError();
            if (!stored) return null;
            // Get the Osm instance from worker (already has spatial indexes built)
            return { stored, osm: await remote.get(stored.entry.fileHash) };
          });

          if (stored) {
            // Final check before setting state
            if (signal?.aborted) throw new LoadCancelledError();

            setOsmInfo(stored.stored.info);
            setOsm(stored.osm);
            setIsStored(true);

            task.end(`${file.name} loaded from cache`);
            return stored.stored.info;
          }
        }

        // Parse the file normally in the worker with explicit file type
        const osmInfo = await task.runStep("Parse and index file", async () => {
          const pbfInput = isPbfFile(file, fileType);
          loadCapabilities = pbfInput ? await getBrowserLoadCapabilities() : undefined;
          return remote.fromFile(
            file,
            {
              id: fileHash,
              ...(pbfInput ? { loadProfile: requestedProfile, loadCapabilities } : {}),
            },
            fileType,
          );
        });

        // Check after parsing
        if (signal?.aborted) throw new LoadCancelledError();

        setOsmInfo(osmInfo);
        const osm = await remote.get(osmInfo.id);

        // Final check before setting state
        if (signal?.aborted) throw new LoadCancelledError();

        setOsm(osm);

        task.end(`${file.name} loaded`);
        return osmInfo;
      } catch (e) {
        if (signal?.aborted || e instanceof LoadCancelledError) {
          // Only reset state if this is still the current load
          // (prevents stale cancellations from clearing newer load state)
          if (loadId === currentLoadIdRef.current) {
            setFile(null);
            setFileInfo(null);
            setOsm(null);
            setOsmInfo(null);
            setIsStored(false);
          }
          task.cancelled(`${file.name} loading cancelled`);
          return null;
        }
        console.error(e);
        const failure = await describeLoadFailure(e, {
          sourceName: file.name,
          requestedProfile: profileOverride ?? loadProfile,
          capabilities: loadCapabilities,
          allowViewRetry: true,
        });
        if (loadId === currentLoadIdRef.current) setLoadFailure(failure);
        task.fail(e, failure.activityMessage);
        return null;
      }
    },
  );

  const loadExtractFromPbf = useEffectEvent(
    async (
      file: File | null,
      extract: {
        extractBbox: GeoBbox2D;
        extractStrategy: ExtractStrategy;
        extractTagFilter: ExtractTagFilterRules;
      },
      controller?: AbortController,
    ) => {
      const loadId = ++currentLoadIdRef.current;
      invalidateDataset();
      setFile(file);
      setOsm(null);
      setFileInfo(null);
      setIsStored(false);
      setLoadFailure(null);
      if (file == null) return null;
      const signal = controller?.signal;
      const task = Tasks.start(`Extract from ${file.name}`, { controller });
      try {
        if (signal?.aborted) throw new LoadCancelledError();

        const fileHash = await task.runStep("Hash file", () =>
          hashFileWithCancellation(remote, file, signal),
        );
        if (signal?.aborted) throw new LoadCancelledError();

        const storedFileInfo: StoredFileInfo = {
          fileHash,
          fileName: file.name,
          fileSize: file.size,
        };
        setFileInfo(storedFileInfo);

        const osmInfo = await task.runStep("Read PBF and apply extract", async () => {
          const loadCapabilities = await getBrowserLoadCapabilities();
          return remote.fromFile(
            file,
            {
              id: fileHash,
              extractBbox: extract.extractBbox,
              extractStrategy: extract.extractStrategy,
              extractTagFilter: extract.extractTagFilter,
              loadProfile: extract.extractStrategy === "simple" ? loadProfile : "full",
              loadCapabilities,
            },
            "pbf",
          );
        });

        if (signal?.aborted) throw new LoadCancelledError();

        setOsmInfo(osmInfo);
        const osm = await remote.get(osmInfo.id);

        if (signal?.aborted) throw new LoadCancelledError();

        setOsm(osm);

        task.end(`${file.name} extracted`);
        return osmInfo;
      } catch (e) {
        if (signal?.aborted || e instanceof LoadCancelledError) {
          if (loadId === currentLoadIdRef.current) {
            setFile(null);
            setFileInfo(null);
            setOsm(null);
            setOsmInfo(null);
            setIsStored(false);
          }
          task.cancelled("Extract cancelled");
          return null;
        }
        console.error(e);
        const failure = await describeLoadFailure(e, {
          sourceName: file.name,
          requestedProfile: extract.extractStrategy === "simple" ? loadProfile : "full",
          allowViewRetry: false,
        });
        if (loadId === currentLoadIdRef.current) setLoadFailure(failure);
        task.fail(e, failure.activityMessage);
        return null;
      }
    },
  );

  const loadOsmPbfUrl = useEffectEvent(
    async (url: string, controller?: AbortController, profileOverride?: OsmLoadProfile) => {
      const loadId = ++currentLoadIdRef.current;
      invalidateDataset();
      sourceUrlRef.current = url;
      setFile(null);
      setOsm(null);
      setFileInfo(null);
      setIsStored(false);
      setLoadFailure(null);
      const signal = controller?.signal;
      const task = Tasks.start(`Open ${url}`, { controller });
      try {
        if (signal?.aborted) throw new LoadCancelledError();
        const requestedProfile = profileOverride ?? loadProfile;
        const result = await task.runStep("Stream, parse and index PBF", async () => {
          const loadCapabilities = await getBrowserLoadCapabilities();
          return remote.fromPbfUrl(
            url,
            {
              loadProfile: requestedProfile,
              loadCapabilities,
            },
            signal,
          );
        });
        if (signal?.aborted) throw new LoadCancelledError();
        const loadedOsm = await remote.get(result.info.id);
        if (signal?.aborted) throw new LoadCancelledError();
        setFileInfo(result.fileInfo);
        setOsmInfo(result.info);
        setOsm(loadedOsm);
        setIsStored(
          result.existing !== null && cachedProfileIsUsable(requestedProfile, result.existing.info),
        );
        task.end(`${result.fileInfo.fileName} loaded from URL`);
        return result.info;
      } catch (error) {
        if (signal?.aborted || error instanceof LoadCancelledError) {
          if (loadId === currentLoadIdRef.current) {
            setFileInfo(null);
            setOsm(null);
            setOsmInfo(null);
            setIsStored(false);
          }
          task.cancelled("URL loading cancelled");
          return null;
        }
        console.error(error);
        const failure = await describeLoadFailure(error, {
          sourceName: url,
          requestedProfile: profileOverride ?? loadProfile,
          allowViewRetry: true,
        });
        if (loadId === currentLoadIdRef.current) setLoadFailure(failure);
        task.fail(error, failure.activityMessage);
        return null;
      }
    },
  );

  const reloadWithProfile = useEffectEvent(async (profile: "full" | "view") => {
    setLoadProfile(profile);
    if (file) return loadOsmFile(file, "pbf", new AbortController(), profile);
    const sourceUrl = fileInfo?.sourceUrl ?? sourceUrlRef.current;
    if (sourceUrl) {
      return loadOsmPbfUrl(sourceUrl, new AbortController(), profile);
    }
    const profileName = profile === "full" ? "Full" : "View";
    Tasks.message(
      `The original PBF is not available in this session. Select it again and choose ${profileName}.`,
      "error",
    );
    return null;
  });

  const reloadWithFullProfile = useEffectEvent(() => reloadWithProfile("full"));
  const reloadWithViewProfile = useEffectEvent(() => reloadWithProfile("view"));

  const loadFromStorage = useEffectEvent(
    async (storageId: string, controller?: AbortController) => {
      const loadId = ++currentLoadIdRef.current;
      invalidateDataset();
      setLoadFailure(null);
      const signal = controller?.signal;
      const task = Tasks.start("Open from browser storage", { controller });
      try {
        // Check cancellation before starting
        if (signal?.aborted) throw new LoadCancelledError();

        // Load from IndexedDB in the worker
        const stored = await task.runStep("Read stored dataset", async () => {
          const stored = await remote.loadFromStorage(storageId, signal);
          if (!stored) {
            throw new Error(`OSM dataset ${storageId} was not found in browser storage.`);
          }
          return stored;
        });

        // Check after loading from storage
        if (signal?.aborted) throw new LoadCancelledError();

        // Get the Osm instance from worker (already has spatial indexes built)
        // Worker registers under fileHash, so use that as the ID
        const osm = await remote.get(stored.entry.fileHash);

        // Final check before setting state
        if (signal?.aborted) throw new LoadCancelledError();

        // Update osmInfo.id to match the storage key (fileHash) since that's where
        // the worker has it registered. This ensures downloadOsm and other calls
        // that use osmInfo.id will find the correct worker entry.
        const osmInfo: OsmInfo = { ...stored.info, id: stored.entry.fileHash };
        setOsmInfo(osmInfo);
        setOsm(osm);
        setIsStored(true);

        // Restore file info from storage (clear actual file since we loaded from storage)
        setFile(null);
        setFileInfo(stored.entry);

        task.end(`${stored.entry.fileName} loaded from storage`);
        return osmInfo;
      } catch (e) {
        if (signal?.aborted || e instanceof LoadCancelledError) {
          // Only reset state if this is still the current load
          // (prevents stale cancellations from clearing newer load state)
          if (loadId === currentLoadIdRef.current) {
            setFile(null);
            setFileInfo(null);
            setOsm(null);
            setOsmInfo(null);
            setIsStored(false);
          }
          task.cancelled("Loading from storage cancelled");
          return null;
        }
        console.error(e);
        const failure = await describeLoadFailure(e, {
          sourceName: storageId,
          allowViewRetry: false,
        });
        if (loadId === currentLoadIdRef.current) setLoadFailure(failure);
        task.fail(e, failure.activityMessage);
        return null;
      }
    },
  );

  const downloadOsm = useEffectEvent(
    async (name?: string, options: { renumberNegativeIds?: boolean } = {}) => {
      if (!osmInfo) return;
      const fallbackName = osmInfo.id.endsWith(".pbf") ? osmInfo.id : `${osmInfo.id}.pbf`;
      const sourceName = fileInfo?.fileName ?? fallbackName;
      const withPrefix = sourceName.startsWith("osmix-") ? sourceName : `osmix-${sourceName}`;
      const rawSuggestedName = name ?? withPrefix;
      const suggestedName = ensureOsmPbfDownloadName(rawSuggestedName);
      // Errors are recorded, not rethrown: a rejected action reaches the app-wide error boundary.
      let target: Awaited<ReturnType<typeof chooseSaveTarget>>;
      try {
        // Choose the destination before the task starts, so the timer measures only the export.
        target = await chooseSaveTarget({
          suggestedName,
          types: [
            {
              description: "OSM PBF",
              accept: { "application/x-protobuf": [".pbf"] },
            },
          ],
        });
      } catch (error) {
        if (error instanceof Error && error.name === "AbortError") return;
        console.error(error);
        const message = error instanceof Error ? error.message : String(error);
        Tasks.message(`Export failed: ${message}`, "error");
        return;
      }
      const task = Tasks.start(
        `Export ${target.kind === "file" ? target.handle.name : target.name}`,
      );
      try {
        let fileName: string;
        if (target.kind === "file") {
          // The worker writes straight to the picked file.
          const handle = target.handle;
          await task.runStep("Write PBF", () => remote.toPbfFile(osmInfo.id, handle, options));
          fileName = handle.name;
        } else {
          task.message("Native save picker unavailable, falling back to browser download", "warn");
          const blob = await task.runStep("Write PBF", () => remote.toPbfBlob(osmInfo.id, options));
          downloadBlob(blob, target.name);
          fileName = target.name;
        }
        task.end(`Exported ${fileName}`);
      } catch (error) {
        console.error(error);
        const message = error instanceof Error ? error.message : String(error);
        task.fail(error, `Export failed: ${message}`);
      }
    },
  );

  const saveToStorage = useEffectEvent(async () => {
    if (!osmInfo || !fileInfo || isStored) return;

    // Check storage availability
    const storableBytes =
      osmInfo.loadDiagnostics?.bytes.storageBytes ??
      (await remote.getStorableByteLength(osmInfo.id));
    const storageCheck = await canStoreBytes(storableBytes);
    if (!storageCheck.canStore) {
      Tasks.message(
        `Insufficient storage: need ${Math.ceil(storageCheck.requiredBytes / 1024 / 1024)}MB, ` +
          `have ${Math.ceil(storageCheck.availableBytes / 1024 / 1024)}MB available`,
        "error",
      );
      return;
    }

    await Tasks.run(
      "Save to browser storage",
      async () => {
        await remote.storeCurrentOsm(osmInfo.id, fileInfo);
        setIsStored(true);
      },
      { summary: () => `${fileInfo.fileName} saved to storage` },
    );
  });

  /**
   * Take over a snapshot of another `useOsmFile` slot's loaded state, load profile included, so
   * a dataset moves between slots without reloading. Merge's "Use as base" moves the patch into
   * an empty base slot this way. The caller clears the source slot itself.
   */
  const copyStateFrom = useEffectEvent(
    (source: {
      file: File | null;
      fileInfo: StoredFileInfo | null;
      osm: ReturnType<typeof useOsmFile>["osm"];
      osmInfo: ReturnType<typeof useOsmFile>["osmInfo"];
      isStored: boolean;
      loadProfile: OsmLoadProfile;
    }) => {
      invalidateDataset();
      setFile(source.file);
      setFileInfo(source.fileInfo);
      setOsm(source.osm);
      setOsmInfo(source.osmInfo);
      setIsStored(source.isStored);
      setLoadProfile(source.loadProfile);
      setLoadFailure(null);
    },
  );

  /**
   * Update the osm state with a newly generated/merged result.
   * Creates new file info with unique hash and name, resets stored state.
   * If the content hasn't changed (same content hash as original), keeps original file info.
   */
  const setMergedOsm = useEffectEvent(async (newOsmId: string, mergedFileName?: string) => {
    const prepared = await prepareMergedOsmState({
      currentFileInfo: fileInfo,
      currentOsm: osm,
      mergedFileName,
      newOsmId,
      worker: remote,
    });

    // Check if anything actually changed using isEqual
    if (prepared.kind === "unchanged") {
      // No changes - keep the original file info and stored state
      setOsm(prepared.osm);
      setOsmInfo(prepared.osmInfo);
      setLoadFailure(null);
      return prepared.osm;
    }

    // The helper has refreshed the content-addressed worker instance and metadata.
    sourceUrlRef.current = null;
    setFile(null); // No actual File object for merged results
    setFileInfo(prepared.fileInfo);
    setOsm(prepared.osm);
    setOsmInfo(prepared.osmInfo);
    setIsStored(false); // New file, not stored yet
    setLoadFailure(null);

    return prepared.osm;
  });

  const clearLoadFailure = useEffectEvent(() => setLoadFailure(null));

  return {
    /** The role this file fills (e.g. "base", "patch"). Unique per app; use it as a React key. */
    osmKey,
    copyStateFrom,
    canStore: storageCheck?.canStore === true,
    downloadOsm,
    file,
    fileInfo,
    isStored,
    loadFailure,
    loadProfile,
    loadExtractFromPbf,
    loadFromStorage,
    loadOsmFile,
    loadOsmPbfUrl,
    osm,
    osmInfo,
    reloadWithFullProfile,
    reloadWithViewProfile,
    saveToStorage,
    setLoadProfile,
    clearLoadFailure,
    setMergedOsm,
    setOsm,
    storageCheck,
  };
}
