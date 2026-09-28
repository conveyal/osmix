import { useFlyToOsmBounds } from "@osmix/app-components";
import { useLoadFromUrl } from "@osmix/app-core";

import MergeBlock from "../blocks/merge";
import { useBaseOsm } from "../lib/merge-slots";
import { BASE_OSM_KEY } from "../settings";

/** The Merge page's sidebar. The shared map shows the base and patch with the plan layer. */
export function MergeSidebar() {
  const base = useBaseOsm();
  const flyToOsmBounds = useFlyToOsmBounds();

  // Open `?load=<hash>` from storage as the base, or fall back to the most recently used dataset.
  useLoadFromUrl({
    osmKey: BASE_OSM_KEY,
    loadFromStorage: base.loadFromStorage,
    onLoaded: flyToOsmBounds,
  });

  return <MergeBlock />;
}
