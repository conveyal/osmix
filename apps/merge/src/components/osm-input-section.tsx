import { ActionButton, ButtonGroup, SidebarSection } from "@osmix/ui";
import { ArrowUpIcon, DownloadIcon, XIcon } from "lucide-react";
import type { ReactNode } from "react";

/**
 * One Merge input's sidebar section: its title and, once loaded, its file name and file actions,
 * above `children` (the file picker, or the loaded file's info). Shared by the Merge workflow and
 * its lightweight browser harness, so responsive and action behavior use the production
 * component without repeatedly loading Monaco. The section is `flush`; children pad themselves.
 *
 * A patch section given `onUseAsBase` offers "Use as base", the explicit way to move the patch
 * into the base slot; `canUseAsBase={false}` (the base slot is occupied) disables it.
 */
export function OsmInputSection({
  canUseAsBase = true,
  children,
  fileName,
  kind,
  loaded,
  onClear,
  onDownload,
  onUseAsBase,
  title,
}: {
  canUseAsBase?: boolean;
  children?: ReactNode;
  fileName?: string;
  kind: "base" | "patch";
  loaded: boolean;
  onClear: () => Promise<unknown>;
  onDownload: () => Promise<unknown>;
  onUseAsBase?: () => Promise<unknown>;
  title: string;
}) {
  const kindLabel = kind === "base" ? "Base" : "Patch";

  return (
    <SidebarSection
      flush
      title={title}
      action={
        loaded ? (
          <ButtonGroup aria-label={`${kindLabel} OSM file actions`}>
            {kind === "patch" && onUseAsBase ? (
              <ActionButton
                icon={<ArrowUpIcon aria-hidden="true" />}
                label="Use as base"
                disabled={!canUseAsBase}
                onAction={onUseAsBase}
                variant="ghost"
              />
            ) : null}
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
