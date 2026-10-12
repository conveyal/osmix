import {
  isPbfFile,
  type OsmFileSizeGuidance,
  osmFileSizeGuidance,
  reportedDeviceMemoryBytes,
  type StoredOsmEntry,
  useStoredOsm,
  osmLoadProfileAtomFamily,
  osmLoadingAbortControllerAtom,
  useTasks,
} from "@osmix/app-core";
import type { OsmLoadFailure } from "@osmix/app-core";
import { useOsmixRemote } from "@osmix/app-core";
import {
  ActionButton,
  Details,
  DetailsContent,
  DetailsSummary,
  Button,
  IconButton,
  Input,
  Item,
  ItemActions,
  ItemContent,
  ItemGroup,
  ItemHeader,
  ItemTitle,
} from "@osmix/ui";
/**
 * UI component for managing stored Osm data in IndexedDB.
 * Uses BroadcastChannel to receive updates from the worker.
 */
import { useAtom, useAtomValue } from "jotai";
import {
  CheckIcon,
  CircleStopIcon,
  DatabaseIcon,
  PencilIcon,
  RotateCcwIcon,
  Trash2Icon,
  XIcon,
} from "lucide-react";
import type { OsmInfo } from "osmix";
import type { OsmFileType } from "osmix";
import { useEffectEvent, useRef, useState } from "react";

import { OsmFileSizeWarning } from "./osm-file-size-warning.tsx";
import { OsmLoadFailurePanel } from "./osm-load-failure.tsx";
import {
  OsmLoadProfileDisclosure,
  OsmPbfOpenUrlButton,
  OsmPbfSelectFileButton,
} from "./osm-pbf-file-input.tsx";

function formatBytes(bytes: number): string {
  if (bytes === 0) return "0 B";
  const kb = bytes / 1024;
  if (kb < 1000) return `${Math.ceil(kb)} KB`;
  const mb = kb / 1024;
  if (mb < 1000) return `${Math.ceil(mb)} MB`;
  return `${(mb / 1024).toFixed(2)} GB`;
}

function formatDate(timestamp: number): string {
  return new Date(timestamp).toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function formatStats(info: OsmInfo): string {
  const parts: string[] = [];
  if (info.stats.nodes > 0) parts.push(`${info.stats.nodes.toLocaleString()}n`);
  if (info.stats.ways > 0) parts.push(`${info.stats.ways.toLocaleString()}w`);
  if (info.stats.relations > 0) parts.push(`${info.stats.relations.toLocaleString()}r`);
  return parts.join(" / ");
}

interface StoredOsmItemProps {
  entry: StoredOsmEntry;
  onLoad: (id: string) => Promise<OsmInfo | null>;
  isActive?: boolean;
}

function StoredOsmItem({ entry, onLoad, isActive }: StoredOsmItemProps) {
  const remote = useOsmixRemote();
  const [isDeleting, setIsDeleting] = useState(false);
  const [isRenaming, setIsRenaming] = useState(false);
  const [renameValue, setRenameValue] = useState(entry.fileName);
  const inputRef = useRef<HTMLInputElement>(null);

  const handleDelete = useEffectEvent(async () => {
    setIsDeleting(true);
    try {
      await remote.deleteStoredOsm(entry.fileHash);
    } finally {
      setIsDeleting(false);
    }
  });

  const handleStartRename = useEffectEvent(() => {
    setRenameValue(entry.fileName);
    setIsRenaming(true);
    // Focus input after render
    setTimeout(() => inputRef.current?.select(), 0);
  });

  const handleConfirmRename = useEffectEvent(async () => {
    const trimmed = renameValue.trim();
    if (trimmed && trimmed !== entry.fileName) {
      await remote.renameStoredOsm(entry.fileHash, trimmed);
    }
    setIsRenaming(false);
  });

  const handleCancelRename = useEffectEvent(() => {
    setRenameValue(entry.fileName);
    setIsRenaming(false);
  });

  const handleKeyDown = useEffectEvent((e: React.KeyboardEvent) => {
    if (e.key === "Enter") {
      e.preventDefault();
      void handleConfirmRename();
    } else if (e.key === "Escape") {
      e.preventDefault();
      handleCancelRename();
    }
  });

  return (
    <Item role="listitem" variant="row" aria-current={isActive ? "true" : undefined}>
      <ItemHeader>
        {isRenaming ? (
          <Input
            ref={inputRef}
            value={renameValue}
            onChange={(e) => setRenameValue(e.target.value)}
            onKeyDown={handleKeyDown}
            onBlur={handleConfirmRename}
            aria-label="File name"
            className="h-7"
          />
        ) : (
          <ItemTitle className="min-w-0 truncate font-mono">{entry.fileName}</ItemTitle>
        )}

        <ItemActions>
          {isRenaming ? (
            <>
              <IconButton
                variant="outline"
                label="Confirm rename"
                icon={<CheckIcon aria-hidden="true" />}
                onClick={handleConfirmRename}
              />
              <IconButton
                variant="outline"
                label="Cancel rename"
                icon={<XIcon aria-hidden="true" />}
                onClick={handleCancelRename}
              />
            </>
          ) : (
            <>
              <IconButton
                variant="outline"
                label="Rename file"
                icon={<PencilIcon aria-hidden="true" />}
                onClick={handleStartRename}
              />
              <ActionButton
                variant="outline"
                label="Restore from storage"
                icon={<RotateCcwIcon aria-hidden="true" />}
                onAction={() => onLoad(entry.fileHash)}
              />
              <ActionButton
                variant="outline"
                label="Delete from storage"
                icon={<Trash2Icon aria-hidden="true" />}
                disabled={isDeleting}
                onAction={handleDelete}
              />
            </>
          )}
        </ItemActions>
      </ItemHeader>
      <ItemContent className="font-mono text-muted-foreground">
        {formatStats(entry.info)} &middot; {formatDate(entry.lastAccessedAt)}
      </ItemContent>
    </Item>
  );
}

interface StoredOsmListProps {
  activeOsmId?: string;
  loadFailure?: OsmLoadFailure | null;
  onDismissLoadFailure?: () => void;
  onReloadView?: () => unknown;
  osmKey?: string;
  openOsmFile: (file: File | string, fileType?: OsmFileType) => Promise<OsmInfo | null>;
  openOsmPbfUrl?: (url: string) => Promise<OsmInfo | null>;
  /**
   * Cut a region out of a PBF that is too large for this page, without loading it. Offered in
   * the size warning when present.
   */
  onOpenInExtract?: (file: File) => unknown;
  /**
   * Whether to warn, before loading, about a PBF whose size predicts View mode or a failure.
   * Defaults to true. Off where a PBF is streamed rather than loaded (Extract's source).
   */
  warnLargePbf?: boolean;
  /** Whether "Open file" is the next step, and so the primary button. Defaults to true. */
  primary?: boolean;
}

/** A picked file held back by the size warning until the user chooses what to do. */
interface HeldFile {
  file: File;
  fileType?: OsmFileType;
  guidance: Exclude<OsmFileSizeGuidance, { level: "full" }>;
}

/**
 * Open a file or URL, pick the load profile, and restore from the files stored in IndexedDB.
 * It has no frame of its own: place it in a `flush` `SidebarSection`, whose title names the slot
 * it fills. The stored files are a divided list that reaches the section edges.
 */
export function StoredOsmList({
  activeOsmId,
  loadFailure,
  onDismissLoadFailure,
  onReloadView,
  osmKey,
  openOsmFile,
  openOsmPbfUrl,
  onOpenInExtract,
  warnLargePbf = true,
  primary = true,
}: StoredOsmListProps) {
  const remote = useOsmixRemote();
  const { entries, estimatedBytes } = useStoredOsm(remote);
  const loadingState = useAtomValue(osmLoadingAbortControllerAtom);
  const { current } = useTasks();
  const [loadProfile, setLoadProfile] = useAtom(osmLoadProfileAtomFamily(osmKey ?? "default"));
  const isLoading = loadingState !== null && (!osmKey || loadingState.osmKey === osmKey);
  const [heldFile, setHeldFile] = useState<HeldFile | null>(null);

  /** Load a picked file, or hold a large PBF back behind the size warning. */
  const openPickedFile = async (file: File, fileType?: OsmFileType) => {
    setHeldFile(null);
    if (warnLargePbf && isPbfFile(file, fileType)) {
      const guidance = osmFileSizeGuidance(file.size, reportedDeviceMemoryBytes());
      // A View-sized file needs no warning when the user already chose View.
      const expected = guidance.level === "view" && loadProfile === "view";
      if (guidance.level !== "full" && !expected) {
        setHeldFile({ file, fileType, guidance });
        return;
      }
    }
    await openOsmFile(file, fileType);
  };

  return (
    <>
      <div className="flex flex-col gap-1 px-inset pb-inset">
        {isLoading ? (
          <Button
            variant="destructive"
            className="w-full"
            // The load holds the task lock until it actually stops, then clears this state.
            disabled={current?.status === "cancelling"}
            onClick={() => loadingState.controller.abort()}
          >
            <CircleStopIcon aria-hidden="true" />
            {current?.status === "cancelling" ? "Cancelling…" : "Cancel loading"}
          </Button>
        ) : (
          <>
            <OsmPbfSelectFileButton
              primary={primary}
              setFile={async (file, fileType) => {
                if (file == null) return;
                await openPickedFile(file, fileType);
              }}
            />
            <OsmLoadProfileDisclosure
              value={loadProfile}
              onChange={setLoadProfile}
              trigger={(toggle) => (
                <div className="flex items-center justify-between gap-2">
                  <OsmPbfOpenUrlButton
                    openPbfUrl={openOsmPbfUrl}
                    setFile={async (file, fileType) => {
                      if (file == null) return;
                      await openPickedFile(file, fileType);
                    }}
                  />
                  {toggle}
                </div>
              )}
            />
          </>
        )}
      </div>
      {heldFile ? (
        <OsmFileSizeWarning
          className="mx-inset mb-inset"
          fileName={heldFile.file.name}
          guidance={heldFile.guidance}
          onCancel={() => setHeldFile(null)}
          onLoadAnyway={async () => {
            setHeldFile(null);
            await openOsmFile(heldFile.file, heldFile.fileType);
          }}
          onOpenInExtract={
            onOpenInExtract
              ? () => {
                  setHeldFile(null);
                  return onOpenInExtract(heldFile.file);
                }
              : undefined
          }
        />
      ) : null}
      {loadFailure && onDismissLoadFailure ? (
        <OsmLoadFailurePanel
          className="mx-inset mb-inset"
          failure={loadFailure}
          onDismiss={onDismissLoadFailure}
          onReloadView={onReloadView}
        />
      ) : null}
      {entries.length > 0 && (
        <Details>
          <DetailsSummary>
            <DatabaseIcon aria-hidden="true" className="size-3.5" />
            Stored
            <span className="text-muted-foreground">
              &middot; {entries.length} &middot; {formatBytes(estimatedBytes)}
            </span>
          </DetailsSummary>
          <DetailsContent>
            <ItemGroup>
              {entries.map((entry) => (
                <StoredOsmItem
                  key={entry.fileHash}
                  entry={entry}
                  onLoad={openOsmFile}
                  isActive={entry.fileHash === activeOsmId}
                />
              ))}
            </ItemGroup>
          </DetailsContent>
        </Details>
      )}
    </>
  );
}
