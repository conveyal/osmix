import {
  datasetVisibleAtomFamily,
  mapModeAtom,
  osmDatasetVersionAtomFamily,
  selectedOsmAtom,
  selectOsmEntityAtom,
  type UseOsmFileReturn,
} from "@osmix/app-core";
import { atom, useAtom, useAtomValue, useSetAtom, useStore } from "jotai";
import { type ReactNode, useEffect, useMemo } from "react";

import { exitRoutingModeAtom, initialRoutingState, routingStateAtom } from "../state/routing.ts";
import Basemap, { type MapInitialViewState } from "./basemap.tsx";
import { type LoadedMapDataset, MapDatasetsContext } from "./map-datasets.tsx";
import { MapInspector } from "./map-inspector.tsx";
import { MapLegend } from "./map-legend.tsx";
import { MapOverlay } from "./map-overlay.tsx";
import { MapToolbar } from "./map-toolbar.tsx";
import OsmixRasterSource from "./osmix-raster-source.tsx";
import OsmixVectorOverlay from "./osmix-vector-overlay.tsx";
import RouteLayer from "./route-layer.tsx";
import SelectedEntityLayer from "./selected-entity-layer.tsx";

/** One app slot to draw on the map, loaded or not. */
export interface MapDataset {
  /** The slot, from `useOsmFile(osmKey)`. Nothing is drawn while it has no `osm`. */
  osmFile: UseOsmFileReturn;
  /** The map colour and line style; defaults to `base`. */
  role?: "base" | "patch";
  /** The name in the legend, the inspector and announcements; defaults to the file name. */
  label?: string;
}

/** Joins slot keys into one memo dependency; slot keys are short words, never NUL. */
const KEY_SEPARATOR = "\u0000";

/** The label a dataset gets when the caller gives none. */
function datasetLabel({ osmFile, label }: MapDataset): string {
  return label ?? osmFile.file?.name ?? osmFile.fileInfo?.fileName ?? "Dataset";
}

/**
 * The map the apps render: the basemap with every loaded dataset's raster preview and vector
 * overlay, the selection layer, the route layer (with `tools.routing`), the caller's own layers
 * as `children`, and the overlay (toolbar, search, inspector, legend). It provides the loaded
 * datasets through `useMapDatasets()` and keeps the shared map state consistent: a selection
 * whose dataset was unloaded is cleared, a selection on a hidden dataset shows it again, a
 * slot's visibility resets when its dataset changes, and routing exits when the tool is off, no
 * dataset is loaded and visible, or its dataset is gone.
 *
 * `initialViewState` seeds the camera once, at mount; fit the map yourself after a load
 * (`useFlyToOsmBounds`). The app keeps one map mounted across its pages; `active={false}`
 * (a page without the map, such as Home, covers it) drops the overlay, so the toolbar leaves
 * the nav, while the map and its sources stay loaded.
 */
export function OsmixMap({
  active = true,
  datasets,
  initialViewState,
  tools,
  legend,
  fadeDatasets = false,
  children,
}: {
  active?: boolean;
  /**
   * Fade every dataset's preview and overlay, so the caller's layers stand out: Merge sets it
   * while a plan feature is selected.
   */
  fadeDatasets?: boolean;
  datasets: MapDataset[];
  initialViewState?: MapInitialViewState;
  tools?: { routing?: boolean };
  /** Keys to the caller's own layers, shown in the legend under the dataset rows. */
  legend?: ReactNode;
  children?: ReactNode;
}) {
  const routing = tools?.routing === true;
  const osmKeysId = datasets.map((dataset) => dataset.osmFile.osmKey).join(KEY_SEPARATOR);
  // One derived atom reads every slot's visibility, so the list can be any length.
  const visibleAtom = useMemo(() => {
    const osmKeys = osmKeysId === "" ? [] : osmKeysId.split(KEY_SEPARATOR);
    return atom((get) => osmKeys.map((key) => get(datasetVisibleAtomFamily(key))));
  }, [osmKeysId]);
  const visibles = useAtomValue(visibleAtom);

  const loaded: LoadedMapDataset[] = [];
  datasets.forEach((dataset, index) => {
    const { osmFile } = dataset;
    if (!osmFile.osm || !osmFile.osmInfo) return;
    loaded.push({
      osmKey: osmFile.osmKey,
      role: dataset.role ?? "base",
      label: datasetLabel(dataset),
      osm: osmFile.osm,
      osmInfo: osmFile.osmInfo,
      osmFile,
      visible: visibles[index] ?? true,
    });
  });

  return (
    <MapDatasetsContext value={loaded}>
      {datasets.map((dataset) => (
        <DatasetSlotHygiene key={dataset.osmFile.osmKey} osmKey={dataset.osmFile.osmKey} />
      ))}
      <SelectionHygiene datasets={loaded} />
      <RoutingHygiene datasets={loaded} routing={routing} />
      <Basemap initialViewState={initialViewState}>
        {loaded.map((dataset) => (
          <DatasetSources
            key={`${dataset.role}:${dataset.osm.id}`}
            dataset={dataset}
            faded={fadeDatasets}
          />
        ))}
        <SelectedEntityLayer />
        {routing ? <RouteLayer /> : null}
        {children}
        {active ? (
          <MapOverlay
            toolbar={<MapToolbar routing={routing} />}
            inspector={<MapInspector />}
            legend={<MapLegend>{legend}</MapLegend>}
          />
        ) : null}
      </Basemap>
    </MapDatasetsContext>
  );
}

/** The raster preview and the interactive overlay for one loaded dataset. */
function DatasetSources({ dataset, faded }: { dataset: LoadedMapDataset; faded: boolean }) {
  const { role, osm, visible } = dataset;
  return (
    <>
      <OsmixRasterSource osmId={osm.id} role={role} visible={visible} faded={faded} />
      <OsmixVectorOverlay osm={osm} role={role} visible={visible} faded={faded} />
    </>
  );
}

/**
 * A slot's visibility resets to shown whenever its dataset is replaced or cleared (loads,
 * clears and `copyStateFrom` bump the version; `setMergedOsm` does not, so a hidden base stays
 * hidden through an apply).
 */
function DatasetSlotHygiene({ osmKey }: { osmKey: string }) {
  const version = useAtomValue(osmDatasetVersionAtomFamily(osmKey));
  const setVisible = useSetAtom(datasetVisibleAtomFamily(osmKey));
  useEffect(() => {
    setVisible(true);
  }, [setVisible, version]);
  return null;
}

/**
 * Clear a selection whose dataset is no longer loaded. A selection on a hidden dataset shows
 * the dataset again instead, so a programmatic select (search, a changes list) always shows
 * its entity; hiding a dataset from the legend is the only way to lose a selection.
 */
function SelectionHygiene({ datasets }: { datasets: LoadedMapDataset[] }) {
  const selectedOsm = useAtomValue(selectedOsmAtom);
  const selectOsmEntity = useSetAtom(selectOsmEntityAtom);
  const store = useStore();
  const owner = selectedOsm ? datasets.find((dataset) => dataset.osm === selectedOsm) : null;
  const unloaded = selectedOsm !== null && !owner;
  const hiddenOwnerKey = owner && !owner.visible ? owner.osmKey : null;
  useEffect(() => {
    if (unloaded) selectOsmEntity(null, null);
  }, [selectOsmEntity, unloaded]);
  useEffect(() => {
    if (hiddenOwnerKey !== null) store.set(datasetVisibleAtomFamily(hiddenOwnerKey), true);
  }, [hiddenOwnerKey, store]);
  return null;
}

/**
 * Leave route mode when the tool is off, no loaded dataset is visible, or the routed dataset
 * was unloaded; clear the route (but stay in the mode) when its dataset is hidden. Outside route
 * mode nothing legitimately writes routing state, so a stray state (a click that resolved after
 * the tool exited) is reset.
 */
function RoutingHygiene({ datasets, routing }: { datasets: LoadedMapDataset[]; routing: boolean }) {
  const mode = useAtomValue(mapModeAtom);
  const [routingState, setRoutingState] = useAtom(routingStateAtom);
  const exitRouting = useSetAtom(exitRoutingModeAtom);

  const routed = routingState.osmId
    ? datasets.filter((dataset) => dataset.osm.id === routingState.osmId)
    : null;
  const noneVisible = !datasets.some((dataset) => dataset.visible);
  const mustExit =
    mode === "route" && (!routing || noneVisible || (routed !== null && routed.length === 0));
  const stray = mode === "select" && routingState !== initialRoutingState;
  const routeHidden =
    mode === "route" &&
    !mustExit &&
    routed !== null &&
    routed.length > 0 &&
    routed.every((dataset) => !dataset.visible);

  useEffect(() => {
    if (mustExit) exitRouting();
    else if (stray || routeHidden) setRoutingState(initialRoutingState);
  }, [exitRouting, mustExit, routeHidden, setRoutingState, stray]);
  return null;
}
