import { ActionButton, ButtonGroup, CardAction, CardDescription, CardHeader } from "@osmix/ui";
import { DownloadIcon, XIcon } from "lucide-react";

/**
 * Loaded-input chrome shared by the Merge workflow and its lightweight browser
 * harness. Keeping this independent from OSM parsing lets responsive and action
 * behavior use the production component without repeatedly loading Monaco.
 */
export function OsmInputCardHeader({
  fileName,
  kind,
  loaded,
  onClear,
  onDownload,
  title,
}: {
  fileName?: string;
  kind: "base" | "patch";
  loaded: boolean;
  onClear: () => Promise<unknown>;
  onDownload: () => Promise<unknown>;
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
              <ActionButton
                icon={<DownloadIcon />}
                title={`Download ${kind} OSM`}
                onAction={onDownload}
                variant="ghost"
              />
              <ActionButton
                icon={<XIcon />}
                title={`Clear ${kind} OSM file`}
                onAction={onClear}
                variant="ghost"
              />
            </ButtonGroup>
          </CardAction>
        ) : null}
      </CardHeader>
      {fileName ? (
        <CardDescription className="truncate border-b px-2 py-1 font-mono" title={fileName}>
          {fileName}
        </CardDescription>
      ) : null}
    </>
  );
}
