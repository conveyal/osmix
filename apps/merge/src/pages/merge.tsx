import { Tabs } from "@base-ui/react/tabs";
import { useAtom, useSetAtom } from "jotai";
import type { OsmFileType } from "osmix";
import { useEffect, useMemo, useRef } from "react";
import { useLocation, useNavigate, useSearchParams } from "react-router";

import ExtractBlock from "../blocks/extract";
import InspectBlock from "../blocks/inspect";
import MergeBlock from "../blocks/merge";
import Basemap, { type MapInitialViewState } from "../components/basemap";
import { ConflationComparisonLayer } from "../components/conflation-comparison-layer";
import CustomControl from "../components/custom-control";
import EntityDetailsMapControl from "../components/entity-details-map-control";
import ExtractMapLayers from "../components/extract-map-layers";
import { Main, MapContent, Sidebar } from "../components/layout";
import OsmFileMapControl from "../components/osm-file-map-control";
import { OsmixMapSources } from "../components/osmix-map-sources";
import SelectedEntityLayer from "../components/selected-entity-layer";
import SidebarLog from "../components/sidebar-log";
import { buttonVariants } from "../components/ui/button";
import { useLog } from "../hooks/log";
import { useFlyToOsmBounds } from "../hooks/map";
import { useOsmFile } from "../hooks/osm";
import { DEFAULT_EXTRACT_BBOX } from "../lib/extract-bbox";
import { cn } from "../lib/utils";
import { BASE_OSM_KEY, EXTRACT_OSM_KEY, PATCH_OSM_KEY } from "../settings";
import { changesetStatsAtom } from "../state/changes";
import { activeTabAtom } from "../state/extract";
import { selectOsmEntityAtom } from "../state/osm";
import { osmLoadingAbortControllerAtom } from "../state/status";
import { osmWorker } from "../state/worker";

export default function Merge() {
  const base = useOsmFile(BASE_OSM_KEY);
  const patch = useOsmFile(PATCH_OSM_KEY);
  const extract = useOsmFile(EXTRACT_OSM_KEY);
  const setChangesetStats = useSetAtom(changesetStatsAtom);
  const flyToOsmBounds = useFlyToOsmBounds();
  const selectEntity = useSetAtom(selectOsmEntityAtom);
  const autoLoadAttempted = useRef(false);
  const location = useLocation();
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const { activeTasks } = useLog();
  const isBusy = activeTasks > 0;
  const [activeTab, setActiveTab] = useAtom(activeTabAtom);
  const setLoadingState = useSetAtom(osmLoadingAbortControllerAtom);

  // Handle auto-loading from URL parameter or most recently used file
  useEffect(() => {
    if (autoLoadAttempted.current) return;
    autoLoadAttempted.current = true;

    const loadId = searchParams.get("load");
    if (loadId) {
      // Clear the URL parameter
      setSearchParams({}, { replace: true });
      // Load the file from storage
      void base.loadFromStorage(loadId).then((osmInfo) => {
        if (osmInfo) {
          flyToOsmBounds(osmInfo);
        }
      });
    } else {
      // No URL parameter, try to load the most recently used file
      void osmWorker.getMostRecentlyUsed().then((mostRecent) => {
        if (mostRecent) {
          void base.loadFromStorage(mostRecent.fileHash).then((osmInfo) => {
            if (osmInfo) flyToOsmBounds(osmInfo);
          });
        }
      });
    }
  }, [searchParams, setSearchParams, base.loadFromStorage, flyToOsmBounds, base]);

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

  const openOsmFile = async (file: File | string, fileType?: OsmFileType) => {
    selectEntity(null, null);
    setChangesetStats(null);

    const abortController = new AbortController();
    setLoadingState({ controller: abortController, osmKey: BASE_OSM_KEY });

    try {
      const osmInfo =
        typeof file === "string"
          ? await base.loadFromStorage(file, abortController.signal)
          : await base.loadOsmFile(file, fileType, abortController.signal);
      if (osmInfo) flyToOsmBounds(osmInfo);
      return osmInfo;
    } finally {
      setLoadingState(null);
    }
  };

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
                  "data-active:border-accent-foreground",
                  isBusy && "opacity-50 cursor-not-allowed",
                )}
                disabled={isBusy}
                value="Inspect"
              >
                Inspect
              </Tabs.Tab>
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
            <Tabs.Panel value="Inspect">
              <InspectBlock openOsmFile={openOsmFile} />
            </Tabs.Panel>
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
