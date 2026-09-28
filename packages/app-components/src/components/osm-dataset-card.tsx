import type { UseOsmFileReturn } from "@osmix/app-core";
import {
  ActionButton,
  ButtonGroup,
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardHeader,
} from "@osmix/ui";
import { DownloadIcon, SaveIcon, XIcon } from "lucide-react";
import type { ReactNode } from "react";

import OsmInfoTable from "./osm-info-table.tsx";

/**
 * The sidebar card for a loaded dataset: its file name, the "File info" table, and the dataset
 * actions: "Save {name} to storage" (only while the dataset can be stored and is not yet),
 * "Export {name} as PBF" and "Clear {name}" (only with `onClear`).
 * `name` is the lowercase noun the labels use ("dataset", "extract result", "merged OSM").
 * `actions` turns an action off when the step already offers it. `primaryAction` sits above
 * the table, `children` below it. Fitting the map is the legend's and the toolbar's job.
 */
export function OsmDatasetCard({
  title,
  name,
  osmFile,
  onClear,
  actions,
  primaryAction,
  children,
}: {
  title: string;
  name: string;
  osmFile: UseOsmFileReturn;
  onClear?: () => unknown;
  actions?: { download?: boolean; save?: boolean };
  primaryAction?: ReactNode;
  children?: ReactNode;
}) {
  const { osm, file, fileInfo, isStored, canStore } = osmFile;
  if (!osm) return null;
  const fileName = file?.name ?? fileInfo?.fileName;
  const showSave = actions?.save !== false && !isStored && canStore;
  const showDownload = actions?.download !== false;

  return (
    <Card data-slot="osm-dataset-card">
      <CardHeader>
        <span className="min-w-0 flex-1">{title}</span>
        {showSave || showDownload || onClear ? (
          <CardAction>
            <ButtonGroup aria-label={`${title} actions`}>
              {showSave ? (
                <ActionButton
                  variant="ghost"
                  label={`Save ${name} to storage`}
                  icon={<SaveIcon aria-hidden="true" />}
                  onAction={osmFile.saveToStorage}
                />
              ) : null}
              {showDownload ? (
                <ActionButton
                  variant="ghost"
                  label={`Export ${name} as PBF`}
                  icon={<DownloadIcon aria-hidden="true" />}
                  onAction={osmFile.downloadOsm}
                />
              ) : null}
              {onClear ? (
                <ActionButton
                  variant="ghost"
                  label={`Clear ${name}`}
                  icon={<XIcon aria-hidden="true" />}
                  onAction={async () => onClear()}
                />
              ) : null}
            </ButtonGroup>
          </CardAction>
        ) : null}
      </CardHeader>
      {fileName ? (
        <CardDescription className="truncate border-b px-inset py-1 font-mono" title={fileName}>
          {fileName}
        </CardDescription>
      ) : null}
      <CardContent className="p-0">
        {primaryAction ? <div className="border-b p-inset">{primaryAction}</div> : null}
        <OsmInfoTable defaultOpen={false} osm={osm} file={file} fileInfo={fileInfo} />
        {children}
      </CardContent>
    </Card>
  );
}
