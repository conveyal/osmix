import { DownloadIcon, XIcon } from "lucide-react";

import ActionButton from "./action-button";
import { ButtonGroup } from "./ui/button-group";
import { CardAction, CardDescription, CardHeader, CardTitle } from "./ui/card";

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
    <CardHeader className="items-start">
      <div className="min-w-0 flex-1">
        <CardTitle className="leading-tight">{title}</CardTitle>
        {fileName ? (
          <CardDescription
            className="mt-1 truncate font-normal normal-case tracking-normal"
            title={fileName}
          >
            {fileName}
          </CardDescription>
        ) : null}
      </div>
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
  );
}
