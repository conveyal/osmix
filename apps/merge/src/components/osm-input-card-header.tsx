import { ActionButton, ButtonGroup, CardAction, CardDescription, CardHeader } from "@osmix/ui";
import { ArrowUpIcon, DownloadIcon, XIcon } from "lucide-react";

/**
 * Loaded-input chrome shared by the Merge workflow and its lightweight browser
 * harness. Keeping this independent from OSM parsing lets responsive and action
 * behavior use the production component without repeatedly loading Monaco.
 *
 * A patch card given `onUseAsBase` offers "Use as base", the explicit way to move the patch
 * into the base slot; `canUseAsBase={false}` (the base slot is occupied) disables it.
 */
export function OsmInputCardHeader({
  canUseAsBase = true,
  fileName,
  kind,
  loaded,
  onClear,
  onDownload,
  onUseAsBase,
  title,
}: {
  canUseAsBase?: boolean;
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
    <>
      <CardHeader>
        <span className="min-w-0 flex-1">{title}</span>
        {loaded ? (
          <CardAction>
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
          </CardAction>
        ) : null}
      </CardHeader>
      {fileName ? (
        <CardDescription className="truncate border-b px-inset py-1 font-mono" title={fileName}>
          {fileName}
        </CardDescription>
      ) : null}
    </>
  );
}
