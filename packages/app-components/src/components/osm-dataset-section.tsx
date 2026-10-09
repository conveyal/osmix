import type { UseOsmFileReturn } from "@osmix/app-core";
import { ActionButton, ButtonGroup, SidebarSection } from "@osmix/ui";
import { DownloadIcon, SaveIcon, XIcon } from "lucide-react";
import type { ReactNode } from "react";

import OsmInfoTable from "./osm-info-table.tsx";

/**
 * The sidebar section for a loaded dataset: its file name, the "File info" table, and the dataset
 * actions: "Save {name} to storage" (only while the dataset can be stored and is not yet),
 * "Export {name} as PBF" and "Clear {name}" (only with `onClear`).
 * `name` is the lowercase noun the labels use ("dataset", "extract result", "merged OSM").
 * `actions` turns an action off when the step already offers it. `primaryAction` sits above
 * the table, `children` below it. `details` replaces the file name and the "File info" table,
 * for a dataset that is not a file yet (an extract), whose file name and size would describe its
 * source. Fitting the map is the legend's and the toolbar's job.
 */
export function OsmDatasetSection({
  title,
  name,
  osmFile,
  onClear,
  actions,
  primaryAction,
  details,
  children,
}: {
  title: string;
  name: string;
  osmFile: UseOsmFileReturn;
  onClear?: () => unknown;
  actions?: { download?: boolean; save?: boolean };
  primaryAction?: ReactNode;
  details?: ReactNode;
  children?: ReactNode;
}) {
  const { osm, file, fileInfo, isStored, canStore } = osmFile;
  if (!osm) return null;
  const fileName = file?.name ?? fileInfo?.fileName;
  const showSave = actions?.save !== false && !isStored && canStore;
  const showDownload = actions?.download !== false;

  return (
    <SidebarSection
      flush
      title={title}
      action={
        showSave || showDownload || onClear ? (
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
        ) : null
      }
    >
      {fileName && details === undefined ? (
        <p className="truncate px-inset pb-2 font-mono text-muted-foreground" title={fileName}>
          {fileName}
        </p>
      ) : null}
      {primaryAction ? <div className="px-inset pb-inset">{primaryAction}</div> : null}
      {details ?? <OsmInfoTable defaultOpen={false} osm={osm} file={file} fileInfo={fileInfo} />}
      {children}
    </SidebarSection>
  );
}
