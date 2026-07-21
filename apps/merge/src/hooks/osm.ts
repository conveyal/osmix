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

import { getBrowserLoadCapabilities } from "../lib/browser-capabilities";
import { prepareMergedOsmState } from "../lib/merged-osm-state";
import { describeOsmLoadFailure, type OsmLoadFailureContext } from "../lib/osm-load-failure";
import { ensureOsmPbfDownloadName } from "../lib/osm-pbf-download-name";
import { showSaveFilePickerWithFallback } from "../lib/save-file-picker";
import { canStoreBytes } from "../lib/storage-utils";
import { isStreamCloneable } from "../lib/stream-transfer";
import { Log } from "../state/log";
import {
  osmAtomFamily,
  osmFileAtomFamily,
  osmFileInfoAtomFamily,
  osmInfoAtomFamily,
  osmLoadFailureAtomFamily,
  osmLoadProfileAtomFamily,
  osmStoredAtomFamily,
  selectedOsmAtom,
} from "../state/osm";
import { osmWorker } from "../state/worker";
import type { StoredFileInfo } from "../workers/osm.worker";

export class LoadCancelledError extends Error {
  constructor() {
    super("OSM file loading was cancelled");
    this.name = "LoadCancelledError";
  }
}

async function hashFileWithCancellation(file: File, signal?: AbortSignal): Promise<string> {
  if (signal?.aborted) throw new LoadCancelledError();
  const taskId = crypto.randomUUID();
  const cancel = () => {
    osmWorker.cancelHash(taskId);
  };
  signal?.addEventListener("abort", cancel, { once: true });
  try {
    return await osmWorker.hashFile(file, taskId, signal);
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
  const setSelectedOsm = useSetAtom(selectedOsmAtom);

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
          (await osmWorker.getStorableByteLength(osmInfo.id));
        const check = await canStoreBytes(storableBytes);
        if (!disposed) setStorageCheckResult({ osmId: osmInfo.id, check });
      } catch {
        // The dataset may be replaced while this asynchronous estimate is running.
      }
    })();
    return () => {
      disposed = true;
    };
  }, [isStored, osmInfo]);

  const storageCheck =
    !isStored && storageCheckResult && storageCheckResult.osmId === osmInfo?.id
      ? storageCheckResult.check
      : null;

  const loadOsmFile = useEffectEvent(
    async (
      file: File | null,
      fileType?: OsmFileType,
      signal?: AbortSignal,
      profileOverride?: OsmLoadProfile,
    ) => {
      const loadId = ++currentLoadIdRef.current;
      setFile(file);
      sourceUrlRef.current = null;
      setOsm(null);
      setFileInfo(null);
      setIsStored(false);
      setLoadFailure(null);
      if (file == null) return null;
      const taskLog = Log.startTask(`Processing file ${file.name}...`);
      let loadCapabilities: Awaited<ReturnType<typeof getBrowserLoadCapabilities>> | undefined;
      try {
        // Check cancellation before starting
        if (signal?.aborted) throw new LoadCancelledError();

        // Hash the file in the worker to avoid blocking UI
        taskLog.update("Hashing file...");
        const fileHash = await hashFileWithCancellation(file, signal);

        // Check after hashing
        if (signal?.aborted) throw new LoadCancelledError();

        const storedFileInfo: StoredFileInfo = {
          fileHash,
          fileName: file.name,
          fileSize: file.size,
        };
        setFileInfo(storedFileInfo);

        // Check if we already have this file stored (in worker)
        const existing = await osmWorker.findByHash(fileHash, signal);

        // Check after cache lookup
        if (signal?.aborted) throw new LoadCancelledError();

        const requestedProfile = profileOverride ?? loadProfile;
        if (existing && cachedProfileIsUsable(requestedProfile, existing.info)) {
          taskLog.update("Found cached version, loading from storage...");
          const stored = await osmWorker.loadFromStorage(existing.fileHash, signal);

          // Check after loading from storage
          if (signal?.aborted) throw new LoadCancelledError();

          if (stored) {
            // Get the Osm instance from worker (already has spatial indexes built)
            const osm = await osmWorker.get(stored.entry.fileHash);

            // Final check before setting state
            if (signal?.aborted) throw new LoadCancelledError();

            setOsmInfo(stored.info);
            setOsm(osm);
            setSelectedOsm(osm);
            setIsStored(true);

            taskLog.end(`${file.name} loaded from cache.`);
            return stored.info;
          }
        }

        // Parse the file normally in the worker with explicit file type
        taskLog.update("Parsing file...");
        const pbfInput = isPbfFile(file, fileType);
        loadCapabilities = pbfInput ? await getBrowserLoadCapabilities() : undefined;
        const osmInfo: OsmInfo = await osmWorker.fromFile(
          file,
          {
            id: fileHash,
            ...(pbfInput ? { loadProfile: requestedProfile, loadCapabilities } : {}),
          },
          fileType,
        );

        // Check after parsing
        if (signal?.aborted) throw new LoadCancelledError();

        setOsmInfo(osmInfo);
        const osm = await osmWorker.get(osmInfo.id);

        // Final check before setting state
        if (signal?.aborted) throw new LoadCancelledError();

        setOsm(osm);
        setSelectedOsm(osm);

        taskLog.end(`${file.name} loaded.`);
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
          taskLog.end(`${file.name} loading cancelled.`);
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
        taskLog.end(failure.activityMessage, "error");
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
      signal?: AbortSignal,
    ) => {
      const loadId = ++currentLoadIdRef.current;
      setFile(file);
      setOsm(null);
      setFileInfo(null);
      setIsStored(false);
      setLoadFailure(null);
      if (file == null) return null;
      const taskLog = Log.startTask(`Extracting ${file.name}…`);
      try {
        if (signal?.aborted) throw new LoadCancelledError();

        taskLog.update("Hashing file…");
        const fileHash = await hashFileWithCancellation(file, signal);
        if (signal?.aborted) throw new LoadCancelledError();

        const storedFileInfo: StoredFileInfo = {
          fileHash,
          fileName: file.name,
          fileSize: file.size,
        };
        setFileInfo(storedFileInfo);

        taskLog.update("Reading PBF and applying extract…");
        const loadCapabilities = await getBrowserLoadCapabilities();
        const osmInfo: OsmInfo = await osmWorker.fromFile(
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

        if (signal?.aborted) throw new LoadCancelledError();

        setOsmInfo(osmInfo);
        const osm = await osmWorker.get(osmInfo.id);

        if (signal?.aborted) throw new LoadCancelledError();

        setOsm(osm);
        setSelectedOsm(osm);

        taskLog.end(`${file.name} extracted.`);
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
          taskLog.end("Extract cancelled.");
          return null;
        }
        console.error(e);
        const failure = await describeLoadFailure(e, {
          sourceName: file.name,
          requestedProfile: extract.extractStrategy === "simple" ? loadProfile : "full",
          allowViewRetry: false,
        });
        if (loadId === currentLoadIdRef.current) setLoadFailure(failure);
        taskLog.end(failure.activityMessage, "error");
        return null;
      }
    },
  );

  const loadOsmPbfUrl = useEffectEvent(
    async (url: string, signal?: AbortSignal, profileOverride?: OsmLoadProfile) => {
      const loadId = ++currentLoadIdRef.current;
      sourceUrlRef.current = url;
      setFile(null);
      setOsm(null);
      setFileInfo(null);
      setIsStored(false);
      setLoadFailure(null);
      const taskLog = Log.startTask(`Streaming PBF from ${url}...`);
      try {
        if (signal?.aborted) throw new LoadCancelledError();
        const loadCapabilities = await getBrowserLoadCapabilities();
        const requestedProfile = profileOverride ?? loadProfile;
        const result = await osmWorker.fromPbfUrl(
          url,
          {
            loadProfile: requestedProfile,
            loadCapabilities,
          },
          signal,
        );
        if (signal?.aborted) throw new LoadCancelledError();
        const loadedOsm = await osmWorker.get(result.info.id);
        if (signal?.aborted) throw new LoadCancelledError();
        setFileInfo(result.fileInfo);
        setOsmInfo(result.info);
        setOsm(loadedOsm);
        setSelectedOsm(loadedOsm);
        setIsStored(
          result.existing !== null && cachedProfileIsUsable(requestedProfile, result.existing.info),
        );
        taskLog.end(`${result.fileInfo.fileName} loaded from URL.`);
        return result.info;
      } catch (error) {
        if (signal?.aborted || error instanceof LoadCancelledError) {
          if (loadId === currentLoadIdRef.current) {
            setFileInfo(null);
            setOsm(null);
            setOsmInfo(null);
            setIsStored(false);
          }
          taskLog.end("URL loading cancelled.");
          return null;
        }
        console.error(error);
        const failure = await describeLoadFailure(error, {
          sourceName: url,
          requestedProfile: profileOverride ?? loadProfile,
          allowViewRetry: true,
        });
        if (loadId === currentLoadIdRef.current) setLoadFailure(failure);
        taskLog.end(failure.activityMessage, "error");
        return null;
      }
    },
  );

  const reloadWithProfile = useEffectEvent(async (profile: "full" | "view") => {
    setLoadProfile(profile);
    if (file) return loadOsmFile(file, "pbf", undefined, profile);
    const sourceUrl = fileInfo?.sourceUrl ?? sourceUrlRef.current;
    if (sourceUrl) {
      return loadOsmPbfUrl(sourceUrl, undefined, profile);
    }
    const profileName = profile === "full" ? "Full" : "View";
    Log.addMessage(
      `The original PBF is not available in this session. Select it again and choose ${profileName}.`,
      "error",
    );
    return null;
  });

  const reloadWithFullProfile = useEffectEvent(() => reloadWithProfile("full"));
  const reloadWithViewProfile = useEffectEvent(() => reloadWithProfile("view"));

  const loadFromStorage = useEffectEvent(async (storageId: string, signal?: AbortSignal) => {
    const loadId = ++currentLoadIdRef.current;
    setLoadFailure(null);
    const taskLog = Log.startTask("Loading osm from storage...");
    try {
      // Check cancellation before starting
      if (signal?.aborted) throw new LoadCancelledError();

      // Load from IndexedDB in the worker
      const stored = await osmWorker.loadFromStorage(storageId, signal);

      // Check after loading from storage
      if (signal?.aborted) throw new LoadCancelledError();

      if (!stored) throw new Error(`OSM dataset ${storageId} was not found in browser storage.`);

      // Get the Osm instance from worker (already has spatial indexes built)
      // Worker registers under fileHash, so use that as the ID
      const osm = await osmWorker.get(stored.entry.fileHash);

      // Final check before setting state
      if (signal?.aborted) throw new LoadCancelledError();

      // Update osmInfo.id to match the storage key (fileHash) since that's where
      // the worker has it registered. This ensures downloadOsm and other calls
      // that use osmInfo.id will find the correct worker entry.
      const osmInfo: OsmInfo = { ...stored.info, id: stored.entry.fileHash };
      setOsmInfo(osmInfo);
      setOsm(osm);
      setSelectedOsm(osm);
      setIsStored(true);

      // Restore file info from storage (clear actual file since we loaded from storage)
      setFile(null);
      setFileInfo(stored.entry);

      taskLog.end(`${stored.entry.fileName} loaded from storage.`);
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
        taskLog.end("Loading from storage cancelled.");
        return null;
      }
      console.error(e);
      const failure = await describeLoadFailure(e, {
        sourceName: storageId,
        allowViewRetry: false,
      });
      if (loadId === currentLoadIdRef.current) setLoadFailure(failure);
      taskLog.end(failure.activityMessage, "error");
      return null;
    }
  });

  const downloadOsm = useEffectEvent(async (name?: string) => {
    if (!osmInfo) return;
    const task = Log.startTask("Generating OSM file to download");
    const fallbackName = osmInfo.id.endsWith(".pbf") ? osmInfo.id : `${osmInfo.id}.pbf`;
    const sourceName = fileInfo?.fileName ?? fallbackName;
    const withPrefix = sourceName.startsWith("osmix-") ? sourceName : `osmix-${sourceName}`;
    const rawSuggestedName = name ?? withPrefix;
    const suggestedName = ensureOsmPbfDownloadName(rawSuggestedName);
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
        task.update("Native save picker unavailable, falling back to browser download");
      },
    );
    const stream = await fileHandle.createWritable();
    if (isStreamCloneable(stream)) {
      await osmWorker.toPbf(osmInfo.id, stream);
    } else {
      task.update("Stream transfer unsupported in this browser; using buffered download fallback");
      const data = await osmWorker.toPbfData(osmInfo.id);
      await stream.write(data);
      await stream.close();
    }
    task.end(`Created ${fileHandle.name} PBF for download`);
    Log.addMessage(`Download complete: ${fileHandle.name}`);
  });

  const saveToStorage = useEffectEvent(async () => {
    if (!osmInfo || !fileInfo || isStored) return;

    // Check storage availability
    const storableBytes =
      osmInfo.loadDiagnostics?.bytes.storageBytes ??
      (await osmWorker.getStorableByteLength(osmInfo.id));
    const storageCheck = await canStoreBytes(storableBytes);
    if (!storageCheck.canStore) {
      Log.addMessage(
        `Insufficient storage: need ${Math.ceil(storageCheck.requiredBytes / 1024 / 1024)}MB, ` +
          `have ${Math.ceil(storageCheck.availableBytes / 1024 / 1024)}MB available`,
        "error",
      );
      return;
    }

    const task = Log.startTask("Saving to storage...");
    try {
      await osmWorker.storeCurrentOsm(osmInfo.id, fileInfo);
      setIsStored(true);
      task.end(`${fileInfo.fileName} saved to storage.`);
    } catch (e) {
      console.error(e);
      task.end("Failed to save to storage.", "error");
      throw e;
    }
  });

  /**
   * Copy all state from another useOsmFile instance.
   * Used to transfer patch to base when base is cleared.
   */
  const copyStateFrom = useEffectEvent(
    (source: {
      file: File | null;
      fileInfo: StoredFileInfo | null;
      osm: ReturnType<typeof useOsmFile>["osm"];
      osmInfo: ReturnType<typeof useOsmFile>["osmInfo"];
      isStored: boolean;
    }) => {
      setFile(source.file);
      setFileInfo(source.fileInfo);
      setOsm(source.osm);
      setOsmInfo(source.osmInfo);
      setIsStored(source.isStored);
      setSelectedOsm(source.osm);
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
      worker: osmWorker,
    });

    // Check if anything actually changed using isEqual
    if (prepared.kind === "unchanged") {
      // No changes - keep the original file info and stored state
      setOsm(prepared.osm);
      setOsmInfo(prepared.osmInfo);
      setSelectedOsm(prepared.osm);
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
    setSelectedOsm(prepared.osm);
    setLoadFailure(null);

    return prepared.osm;
  });

  const clearLoadFailure = useEffectEvent(() => setLoadFailure(null));

  return {
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
