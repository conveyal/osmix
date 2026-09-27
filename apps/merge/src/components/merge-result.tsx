import { OsmDatasetCard, SaveToDiskNotice } from "@osmix/app-components";
import type { UseOsmFileReturn } from "@osmix/app-core";
import { ActionButton, Checkbox, CheckboxLabel } from "@osmix/ui";
import { ArrowLeftIcon, DownloadIcon, SaveIcon } from "lucide-react";
import type { MergePlanOverview } from "osmix";
import type { ReactNode } from "react";

import { ConflationRoutingDiagnostics } from "./conflation-routing-diagnostics";
import { StepActions } from "./step-actions";

/**
 * The result step: what the merge did, then the merged dataset and its downloads. The summary
 * comes first; **Give new features positive IDs** renumbers only the download.
 */
export function MergeResult({
  base,
  onClear,
  onPositiveIdsChange,
  onStartNew,
  plan,
  positiveIds,
  summary,
}: {
  base: UseOsmFileReturn;
  onClear: () => unknown;
  onPositiveIdsChange: (positiveIds: boolean) => void;
  onStartNew: () => Promise<unknown>;
  plan: MergePlanOverview | null;
  positiveIds: boolean;
  summary: ReactNode;
}) {
  return (
    <>
      {summary}
      {base.osm ? (
        <>
          <OsmDatasetCard
            title="Merged OSM"
            name="merged OSM"
            osmFile={base}
            onClear={() => void onClear()}
            actions={{ download: false, save: false }}
          />
          {plan ? (
            <ConflationRoutingDiagnostics diagnostics={plan.diagnostics.routing} scope="plan" />
          ) : null}
          <SaveToDiskNotice />
          <div className="flex flex-col gap-1">
            <CheckboxLabel className="min-h-8">
              <Checkbox
                checked={positiveIds}
                aria-describedby="positive-ids-help"
                onCheckedChange={onPositiveIdsChange}
              />
              Give new features positive IDs
            </CheckboxLabel>
            <p id="positive-ids-help" className="text-muted-foreground">
              New features have negative IDs, the OSM convention for data not yet uploaded. Some
              tools only accept positive IDs; the merge report then lists each change.
            </p>
          </div>
          <StepActions aria-label="Merged OSM actions">
            {!base.isStored && base.canStore ? (
              <ActionButton icon={<SaveIcon />} onAction={base.saveToStorage} variant="outline">
                Save to storage
              </ActionButton>
            ) : null}
            <ActionButton
              icon={<DownloadIcon />}
              onAction={() => base.downloadOsm(undefined, { renumberNegativeIds: positiveIds })}
            >
              Download merged OSM PBF
            </ActionButton>
            <ActionButton icon={<ArrowLeftIcon />} variant="outline" onAction={onStartNew}>
              Start a new merge
            </ActionButton>
          </StepActions>
        </>
      ) : null}
    </>
  );
}
