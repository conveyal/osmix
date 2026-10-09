import {
  datasetVisibleAtomFamily,
  selectedOsmAtom,
  selectOsmEntityAtom,
  zoomAtom,
} from "@osmix/app-core";
import { IconButton } from "@osmix/ui";
import { useAtom, useAtomValue, useStore } from "jotai";
import { EyeIcon, EyeOffIcon, MaximizeIcon } from "lucide-react";
import type { ReactNode } from "react";

import { MIN_PICKABLE_ZOOM } from "../constants.ts";
import { useFlyToOsmBounds } from "../hooks/map.ts";
import { initialRoutingState, routingStateAtom } from "../state/routing.ts";
import { type LoadedMapDataset, useMapDatasets } from "./map-datasets.tsx";
import { MapPanel, useMapOverlayActions, useMapOverlayLayout } from "./map-overlay.tsx";
import { MapRoleSymbol } from "./map-role-symbol.tsx";

/**
 * The key to the loaded datasets, at the bottom of the map's left column (under the docked
 * inspector): one row per dataset with its role symbol, its label, a show/hide toggle and a fit
 * action. Rendered only while a dataset is loaded, and not while the inspector is docked to the
 * bottom edge (they would share the strip). Below the rows come the keys to the app's own layers
 * (`children`), then a note when the map is zoomed out too far to select features.
 */
export function MapLegend({ children }: { children?: ReactNode }) {
  const datasets = useMapDatasets();
  const { docked } = useMapOverlayLayout();
  const { open } = useMapOverlayActions();
  const zoom = useAtomValue(zoomAtom);

  if (datasets.length === 0) return null;
  if (!docked && open.has("inspector")) return null;

  return (
    <MapPanel width="narrow" data-slot="map-legend" role="group" aria-label="Loaded data">
      {datasets.map((dataset) => (
        <LegendRow key={dataset.osmKey} dataset={dataset} showRole={datasets.length > 1} />
      ))}
      {children}
      {zoom !== null && zoom < MIN_PICKABLE_ZOOM ? (
        <div className="px-inset py-1 text-muted-foreground">Zoom in to select features</div>
      ) : null}
    </MapPanel>
  );
}

function LegendRow({ dataset, showRole }: { dataset: LoadedMapDataset; showRole: boolean }) {
  const [visible, setVisible] = useAtom(datasetVisibleAtomFamily(dataset.osmKey));
  const store = useStore();
  const flyToOsmBounds = useFlyToOsmBounds();
  const { label, role, osm, osmInfo } = dataset;

  // Hiding is the one way to lose a selection or a route on this dataset: drop them first, so
  // nothing on the map points at data that is no longer drawn. (A selection made while hidden
  // shows the dataset again instead; see `OsmixMap`.)
  const toggleVisible = () => {
    if (visible) {
      if (store.get(selectedOsmAtom) === osm) store.set(selectOsmEntityAtom, null, null);
      if (store.get(routingStateAtom).osmId === osm.id) {
        store.set(routingStateAtom, initialRoutingState);
      }
    }
    setVisible(!visible);
  };

  return (
    <div
      data-slot="map-legend-row"
      data-role={role}
      className="flex h-8 items-center gap-2 pl-inset"
    >
      <MapRoleSymbol role={role} />
      <span className="min-w-0 flex-1 truncate font-mono" title={label}>
        {label}
      </span>
      {showRole ? <span className="shrink-0 text-muted-foreground">{role}</span> : null}
      <div className="flex shrink-0 items-center">
        <IconButton
          label={`Show ${label} on the map`}
          aria-pressed={visible}
          icon={visible ? <EyeIcon aria-hidden="true" /> : <EyeOffIcon aria-hidden="true" />}
          onClick={toggleVisible}
        />
        <IconButton
          label={`Fit map to ${label}`}
          icon={<MaximizeIcon aria-hidden="true" />}
          disabled={!osmInfo.bbox}
          onClick={() => flyToOsmBounds(osmInfo)}
        />
      </div>
    </div>
  );
}
