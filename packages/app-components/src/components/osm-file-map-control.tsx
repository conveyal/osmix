import { osmFileControlIsOpenAtom } from "@osmix/app-core";
import type { UseOsmFileReturn } from "@osmix/app-core";
import { ActionButton, IconButton } from "@osmix/ui";
import { useAtomValue } from "jotai";
import {
  DownloadIcon,
  EyeIcon,
  EyeOffIcon,
  FileIcon,
  MaximizeIcon,
  SaveIcon,
  XIcon,
} from "lucide-react";
import { useCallback, useEffect, useState } from "react";

import { APPID } from "../constants.ts";
import { useFlyToOsmBounds, useMap } from "../hooks/map.ts";
import CustomControl from "./custom-control.tsx";
import { MapPanelBody, MapPanelHeader } from "./map-panel-header.tsx";
import OsmInfoTable from "./osm-info-table.tsx";

interface OsmFileCardProps {
  osmFile: UseOsmFileReturn;
  onClear?: () => Promise<void>;
}

function OsmFileCard({ osmFile, onClear }: OsmFileCardProps) {
  const map = useMap();
  const flyToOsmBounds = useFlyToOsmBounds();
  const [layersVisible, setLayersVisible] = useState(true);

  const osmId = osmFile.osm?.id;

  // Get all layer IDs for this OSM file
  const getOsmLayerIds = useCallback(() => {
    if (!map || !osmId) return [];
    const style = map.getStyle();
    if (!style?.layers) return [];
    const prefix = `${APPID}:${osmId}`;
    return style.layers.filter((layer) => layer.id.startsWith(prefix)).map((layer) => layer.id);
  }, [map, osmId]);

  // Check visibility state when map style changes
  useEffect(() => {
    if (!map || !osmId) return;

    const checkVisibility = () => {
      const layerIds = getOsmLayerIds();
      if (layerIds.length === 0) return;
      // Check if any layer is visible
      const anyVisible = layerIds.some((id) => {
        const visibility = map.getLayoutProperty(id, "visibility");
        return visibility !== "none";
      });
      setLayersVisible(anyVisible);
    };

    checkVisibility();
    map.on("styledata", checkVisibility);
    return () => {
      map.off("styledata", checkVisibility);
    };
  }, [map, osmId, getOsmLayerIds]);

  const toggleLayersVisibility = () => {
    if (!map || !osmId) return;
    const layerIds = getOsmLayerIds();
    const newVisibility = layersVisible ? "none" : "visible";
    for (const id of layerIds) {
      map.getMap().setLayoutProperty(id, "visibility", newVisibility);
    }
    setLayersVisible(!layersVisible);
  };

  if (!osmFile.osm || !osmFile.osmInfo || !osmFile.fileInfo) {
    return null;
  }

  const fileName = osmFile.fileInfo.fileName;

  return (
    <>
      <MapPanelHeader
        icon={<FileIcon aria-hidden="true" />}
        title="File"
        detail={fileName}
        actions={
          <>
            <IconButton
              onClick={toggleLayersVisibility}
              label={layersVisible ? "Hide map layers" : "Show map layers"}
              icon={
                layersVisible ? <EyeIcon aria-hidden="true" /> : <EyeOffIcon aria-hidden="true" />
              }
            />
            {!osmFile.isStored && osmFile.canStore && (
              <ActionButton
                onAction={osmFile.saveToStorage}
                variant="ghost"
                label="Save to storage"
                icon={<SaveIcon aria-hidden="true" />}
              />
            )}
            <ActionButton
              onAction={osmFile.downloadOsm}
              variant="ghost"
              label="Download OSM PBF"
              icon={<DownloadIcon aria-hidden="true" />}
            />
            <ActionButton
              onAction={async () => flyToOsmBounds(osmFile.osmInfo)}
              variant="ghost"
              label="Fit bounds to file bbox"
              icon={<MaximizeIcon aria-hidden="true" />}
            />
            {onClear && (
              <ActionButton
                onAction={async () => {
                  void (window.confirm("Clear this file from the map?") && onClear());
                }}
                variant="ghost"
                label="Clear file"
                icon={<XIcon aria-hidden="true" />}
              />
            )}
          </>
        }
      />
      <MapPanelBody>
        <OsmInfoTable
          defaultOpen={false}
          osm={osmFile.osm}
          file={osmFile.file}
          fileInfo={osmFile.fileInfo}
        />
      </MapPanelBody>
    </>
  );
}

export interface OsmFileMapControlProps {
  files: Array<{
    osmFile: UseOsmFileReturn;
    onClear?: () => Promise<void>;
  }>;
}

type PanelFile = {
  osmFile: Pick<UseOsmFileReturn, "osmKey" | "osm" | "osmInfo" | "fileInfo">;
};

/**
 * The loaded files that get a panel, keyed by role (`osmKey`). Not by file hash: Merge can
 * load the same file as both base and patch, and each role still needs its own panel.
 */
export function loadedOsmFilePanels<T extends PanelFile>(files: T[]) {
  return files
    .filter((file) => file.osmFile.osm && file.osmFile.osmInfo && file.osmFile.fileInfo)
    .map((file) => ({ key: file.osmFile.osmKey, file }));
}

export default function OsmFileMapControl({ files }: OsmFileMapControlProps) {
  const isOpen = useAtomValue(osmFileControlIsOpenAtom);
  if (!isOpen) return null;

  return loadedOsmFilePanels(files).map(({ key, file }) => (
    <CustomControl key={key} position="top-left">
      <OsmFileCard osmFile={file.osmFile} onClear={file.onClear} />
    </CustomControl>
  ));
}
