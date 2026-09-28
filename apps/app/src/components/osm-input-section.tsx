import { ActionButton, ButtonGroup, SidebarSection } from "@osmix/ui";
import { ArrowDownUpIcon, DownloadIcon, XIcon } from "lucide-react";
import type { ReactNode } from "react";

/**
 * One Merge input's sidebar section: its title and, once loaded, its file name and file actions,
 * above `children` (the file picker, or the loaded file's info). Shared by the Merge workflow and
 * its lightweight browser harness, so responsive and action behavior use the production
 * component without repeatedly loading Monaco. The section is `flush`; children pad themselves.
 *
 * The section given `onSwap` (the patch, below the base) offers "Swap base and patch", which
 * exchanges the two inputs, or moves the only loaded one into the other slot. It shows even
 * while this slot is empty, since the other may hold a file.
 */
export function OsmInputSection({
  children,
  fileName,
  kind,
  loaded,
  onClear,
  onDownload,
  onSwap,
  title,
}: {
  children?: ReactNode;
  fileName?: string;
  kind: "base" | "patch";
  loaded: boolean;
  onClear: () => Promise<unknown>;
  onDownload: () => Promise<unknown>;
  onSwap?: () => Promise<unknown>;
  title: string;
}) {
  const kindLabel = kind === "base" ? "Base" : "Patch";

  return (
    <SidebarSection
      flush
      title={title}
      action={
        loaded || onSwap ? (
          <ButtonGroup aria-label={`${kindLabel} OSM file actions`}>
            {onSwap ? (
              <ActionButton
                icon={<ArrowDownUpIcon aria-hidden="true" />}
                label="Swap base and patch"
                onAction={onSwap}
                variant="ghost"
              />
            ) : null}
            {loaded ? (
              <>
                <ActionButton
                  icon={<DownloadIcon />}
                  label={`Export ${kind} OSM as PBF`}
                  onAction={onDownload}
                  variant="ghost"
                />
                <ActionButton
                  icon={<XIcon />}
                  label={`Clear ${kind} OSM file`}
                  onAction={onClear}
                  variant="ghost"
                />
              </>
            ) : null}
          </ButtonGroup>
        ) : null
      }
    >
      {fileName ? (
        <p
          data-slot="osm-input-file-name"
          className="truncate px-inset pb-2 font-mono text-muted-foreground"
          title={fileName}
        >
          {fileName}
        </p>
      ) : null}
      {children}
    </SidebarSection>
  );
}
