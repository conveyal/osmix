import { RefreshCwIcon } from "lucide-react";
import type { OsmInfo } from "osmix";

import type { UseOsmFileReturn } from "../hooks/osm";
import ActionButton from "./action-button";

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
    <div className="flex flex-col gap-2 rounded border border-warning/40 bg-warning/10 p-2">
      <p>
        {operation} requires the all-node spatial index. This dataset loaded in View mode, which
        keeps tagged-node, way, and relation indexes but omits the all-node index.
      </p>
      {osmFile.file || osmFile.fileInfo?.sourceUrl ? (
        <ActionButton
          icon={<RefreshCwIcon />}
          variant="outline"
          onAction={osmFile.reloadWithFullProfile}
        >
          Reload using Full mode
        </ActionButton>
      ) : (
        <p className="text-muted-foreground">
          Select the original PBF again and choose Full under Advanced load profile.
        </p>
      )}
    </div>
  );
}
