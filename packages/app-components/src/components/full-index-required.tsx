import type { UseOsmFileReturn } from "@osmix/app-core";
import { ActionButton, Alert } from "@osmix/ui";
import { RefreshCwIcon } from "lucide-react";
import type { OsmInfo } from "osmix";

export function hasFullNodeIndex(info: OsmInfo | null | undefined): boolean {
  return info?.spatialIndexes.nodes.all === true;
}

export function FullIndexRequired({
  operation,
  osmFile,
}: {
  operation: string;
  osmFile: UseOsmFileReturn;
}) {
  if (!osmFile.osmInfo || hasFullNodeIndex(osmFile.osmInfo)) return null;
  return (
    <Alert variant="warning" title="Full index required">
      <p>
        {operation} requires the all-node spatial index. This dataset loaded in View mode, which
        keeps tagged-node, way, and relation indexes but omits the all-node index.
      </p>
      {osmFile.file || osmFile.fileInfo?.sourceUrl ? (
        <ActionButton
          icon={<RefreshCwIcon aria-hidden="true" />}
          variant="outline"
          size="sm"
          className="self-start"
          onAction={osmFile.reloadWithFullProfile}
        >
          Reload using Full mode
        </ActionButton>
      ) : (
        <p className="text-muted-foreground">
          Select the original PBF again with Load profile set to Full.
        </p>
      )}
    </Alert>
  );
}
