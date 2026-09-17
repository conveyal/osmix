import { Tabs } from "@base-ui/react/tabs";
import {
  Basemap,
  type MapInitialViewState,
  CustomControl,
  EntityDetailsMapControl,
  OsmFileMapControl,
  OsmixMapSources,
  SelectedEntityLayer,
  SidebarLog,
  useFlyToOsmBounds,
  RouteLayer,
  RouteMapControl,
} from "@osmix/app-components";
import { useLog, useOsmFile, changesetStatsAtom, selectOsmEntityAtom } from "@osmix/app-core";
import { useLoadFromUrl } from "@osmix/app-core";
import { Main, MapContent, Sidebar, buttonVariants, cn } from "@osmix/ui";
import { useAtom, useSetAtom } from "jotai";
import { useEffect, useMemo } from "react";
import { useLocation, useNavigate } from "react-router";

import ExtractBlock from "../blocks/extract";
import MergeBlock from "../blocks/merge";
import { ConflationComparisonLayer } from "../components/conflation-comparison-layer";
import ExtractMapLayers from "../components/extract-map-layers";
import { DEFAULT_EXTRACT_BBOX } from "../lib/extract-bbox";
import { BASE_OSM_KEY, EXTRACT_OSM_KEY, PATCH_OSM_KEY } from "../settings";
import { activeTabAtom } from "../state/extract";

export default function Merge() {
  const base = useOsmFile(BASE_OSM_KEY);
  const patch = useOsmFile(PATCH_OSM_KEY);
  const extract = useOsmFile(EXTRACT_OSM_KEY);
  const setChangesetStats = useSetAtom(changesetStatsAtom);
  const flyToOsmBounds = useFlyToOsmBounds();
  const selectEntity = useSetAtom(selectOsmEntityAtom);
  const location = useLocation();
  const navigate = useNavigate();
  const { activeTasks } = useLog();
  const isBusy = activeTasks > 0;
  const [storedTab, setActiveTab] = useAtom(activeTabAtom);
  const activeTab = storedTab === "Extract" ? "Extract" : "Merge";

  // Open `?load=<hash>` from storage, or fall back to the most recently used dataset.
  useLoadFromUrl({ loadFromStorage: base.loadFromStorage, onLoaded: flyToOsmBounds });

  useEffect(() => {
    if (location.pathname.endsWith("/extract")) {
      setActiveTab("Extract");
    }
  }, [location.pathname, setActiveTab]);

  const onTabChange = (tab: string) => {
    setActiveTab(tab);
    if (tab === "Extract") {
      void navigate("/extract", { replace: true });
    } else {
      void navigate("/", { replace: true });
    }
  };

  useEffect(() => {
    if (extract.osmInfo) flyToOsmBounds(extract.osmInfo);
  }, [extract.osmInfo, flyToOsmBounds]);

  const initialViewState: MapInitialViewState | undefined = useMemo(() => {
    if (activeTab === "Extract") {
      if (extract.osmInfo?.bbox) {
        return {
          bounds: extract.osmInfo.bbox,
          fitBoundsOptions: { padding: 100 },
        };
      }
      return {
        bounds: DEFAULT_EXTRACT_BBOX,
        fitBoundsOptions: { padding: 80 },
      };
    }
    if (!base.osmInfo?.bbox) return undefined;
    return {
      bounds: base.osmInfo.bbox,
      fitBoundsOptions: { padding: 100 },
    };
  }, [activeTab, base.osmInfo, extract.osmInfo]);

  return (
    <Main>
      <Sidebar>
        <div className="flex-1 p-2 lg:p-4 overflow-y-auto">
          <Tabs.Root value={activeTab} onValueChange={onTabChange}>
            <Tabs.List className="flex gap-2 pb-2">
              <Tabs.Tab
                className={cn(
                  buttonVariants({ variant: "outline", size: "sm" }),
                  "data-active:border-primary",
                  isBusy && "opacity-50 cursor-not-allowed",
                )}
                disabled={isBusy}
                value="Merge"
              >
                Merge
              </Tabs.Tab>
              <Tabs.Tab
                className={cn(
                  buttonVariants({ variant: "outline", size: "sm" }),
                  "data-active:border-accent-foreground",
                  isBusy && "opacity-50 cursor-not-allowed",
                )}
                disabled={isBusy}
                value="Extract"
              >
                Extract
              </Tabs.Tab>
            </Tabs.List>
            <Tabs.Panel value="Merge">
              <MergeBlock />
            </Tabs.Panel>
            <Tabs.Panel value="Extract">
              <ExtractBlock />
            </Tabs.Panel>
          </Tabs.Root>
        </div>
        <SidebarLog />
      </Sidebar>
      <MapContent>
        <Basemap initialViewState={initialViewState}>
          <OsmixMapSources
            activeTab={activeTab}
            baseOsm={base.osm}
            extractOsm={extract.osm}
            patchOsm={patch.osm}
          />

          {activeTab === "Extract" ? <ExtractMapLayers /> : null}

          {activeTab === "Merge" ? <ConflationComparisonLayer /> : null}
          <SelectedEntityLayer />
          <RouteMapControl osmFiles={[base, patch, extract]} />
          <RouteLayer />

          <OsmFileMapControl
            files={[
              {
                osmFile: base,
                onClear: async () => {
                  selectEntity(null, null);
                  setChangesetStats(null);
                  if (patch.osm) {
                    const patchState = {
                      file: patch.file,
                      fileInfo: patch.fileInfo,
                      osm: patch.osm,
                      osmInfo: patch.osmInfo,
                      isStored: patch.isStored,
                    };
                    await patch.loadOsmFile(null);
                    base.copyStateFrom(patchState);
                  } else {
                    await base.loadOsmFile(null);
                  }
                },
              },
              {
                osmFile: patch,
                onClear: async () => {
                  selectEntity(null, null);
                  setChangesetStats(null);
                  await patch.loadOsmFile(null);
                },
              },
            ]}
          />
          {base.osm && (
            <CustomControl position="top-left">
              <EntityDetailsMapControl osm={base.osm} />
            </CustomControl>
          )}
        </Basemap>
      </MapContent>
    </Main>
  );
}
