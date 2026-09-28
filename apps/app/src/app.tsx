import {
  type MapDataset,
  type MapInitialViewState,
  OsmixMap,
  routeForPath,
  type OsmixRoute,
  useMap,
  useMapPadding,
} from "@osmix/app-components";
import { selectOsmEntityAtom, useOsmFile } from "@osmix/app-core";
import { AppSidebar, Main, MapContent } from "@osmix/ui";
import { useAtomValue, useSetAtom } from "jotai";
import type { GeoBbox2D } from "osmix";
import { type ReactNode, useEffect, useEffectEvent, useRef, useState } from "react";
import { Redirect, useLocation } from "wouter";

import { PlanLegend, PlanMapLayer } from "./components/plan-map-layer";
import { useBaseOsm, usePatchOsm } from "./lib/merge-slots";
import { boundsForPage } from "./lib/page-camera";
import { useSelectPlanFeature } from "./lib/use-select-plan-feature";
import ExtractMapLayers from "./pages/extract/components/extract-map-layers";
import { ExtractPanel } from "./pages/extract/extract-panel";
import { extractBboxAtom } from "./pages/extract/state/extract";
import { HomePage } from "./pages/home";
import { InspectSidebar } from "./pages/inspect";
import { MergeSidebar } from "./pages/merge";
import { EXTRACT_OSM_KEY, INSPECT_OSM_KEY } from "./settings";

/** What the shared map shows on a page, and the boxes that page is about. */
interface PageMap {
  datasets: MapDataset[];
  focus: GeoBbox2D[];
  legend?: ReactNode;
  layers?: ReactNode;
  routing?: boolean;
}

/** The shared map's content for each route. Every slot's hook runs on every page. */
function usePageMap(route: OsmixRoute): PageMap {
  const base = useBaseOsm();
  const patch = usePatchOsm();
  const inspect = useOsmFile(INSPECT_OSM_KEY);
  const extract = useOsmFile(EXTRACT_OSM_KEY);
  const extractBbox = useAtomValue(extractBboxAtom);
  const selectPlanFeature = useSelectPlanFeature();
  const boxes = (...infos: ({ bbox: GeoBbox2D | null } | null)[]) =>
    infos.flatMap((info) => (info?.bbox ? [info.bbox] : []));

  switch (route) {
    case "merge":
      return {
        datasets: [
          { osmFile: base, role: "base" },
          { osmFile: patch, role: "patch" },
        ],
        focus: boxes(base.osmInfo, patch.osmInfo),
        legend: <PlanLegend />,
        layers: <PlanMapLayer onSelect={selectPlanFeature} />,
      };
    case "inspect":
      return { datasets: [{ osmFile: inspect }], focus: boxes(inspect.osmInfo), routing: true };
    case "extract":
      return {
        datasets: extract.osm ? [{ osmFile: extract, label: "Extract result" }] : [],
        focus: extract.osmInfo?.bbox ? [extract.osmInfo.bbox] : [extractBbox],
        layers: <ExtractMapLayers />,
      };
    case "home":
      return { datasets: [], focus: [] };
  }
}

function PageSidebar({ route }: { route: OsmixRoute }) {
  switch (route) {
    case "merge":
      return <MergeSidebar />;
    case "inspect":
      return <InspectSidebar />;
    case "extract":
      return <ExtractPanel />;
    case "home":
      return null;
  }
}

/**
 * The app: Home and three pages over one map. The map is mounted once and never unmounted, so
 * its camera, tiles and loaded sources survive navigation; each page supplies its sidebar and
 * what the map shows. Home covers the row with an introduction while the map idles below it.
 */
export function App() {
  const [location] = useLocation();
  const route = routeForPath(location);
  if (route === null) return <Redirect to="/" replace />;
  return <AppRoutes route={route} />;
}

function AppRoutes({ route }: { route: OsmixRoute }) {
  const page = usePageMap(route);
  const map = useMap();
  const mapPadding = useMapPadding();
  const selectEntity = useSetAtom(selectOsmEntityAtom);

  // The camera starts on the first page's data (or Extract's bbox); later pages move it only
  // when none of their data is in view.
  const [initialViewState] = useState<MapInitialViewState | undefined>(() => {
    const bounds = page.focus[0];
    return bounds ? { bounds, fitBoundsOptions: { padding: 100 } } : undefined;
  });

  const openPage = useEffectEvent(() => {
    // A selection belongs to the page it was made on.
    selectEntity(null, null);
    if (!map) return;
    const view = map.getBounds();
    const target = boundsForPage(page.focus, [
      view.getWest(),
      view.getSouth(),
      view.getEast(),
      view.getNorth(),
    ]);
    if (target) map.fitBounds(target, { padding: mapPadding(100), maxDuration: 500 });
  });
  const previousRoute = useRef(route);
  useEffect(() => {
    if (previousRoute.current === route) return;
    previousRoute.current = route;
    openPage();
  }, [route]);

  return (
    <Main>
      {route === "home" ? <HomePage /> : null}
      <AppSidebar>
        <PageSidebar route={route} />
      </AppSidebar>
      <MapContent>
        <OsmixMap
          active={route !== "home"}
          datasets={page.datasets}
          initialViewState={initialViewState}
          legend={page.legend}
          tools={{ routing: page.routing === true }}
        >
          {page.layers}
        </OsmixMap>
      </MapContent>
    </Main>
  );
}
