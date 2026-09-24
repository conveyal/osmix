import { osmFileControlIsOpenAtom } from "@osmix/app-core";
import type { UseOsmFileReturn } from "@osmix/app-core";
import { ActionButton, Button } from "@osmix/ui";
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
import { MapPanelHeader } from "./map-panel-header.tsx";
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
            <Button
              onClick={toggleLayersVisibility}
              variant="ghost"
              size="icon-sm"
              title={layersVisible ? "Hide map layers" : "Show map layers"}
              aria-label={layersVisible ? "Hide map layers" : "Show map layers"}
            >
              {layersVisible ? <EyeIcon aria-hidden="true" /> : <EyeOffIcon aria-hidden="true" />}
            </Button>
            {!osmFile.isStored && osmFile.canStore && (
              <ActionButton
                onAction={osmFile.saveToStorage}
                variant="ghost"
                icon={<SaveIcon aria-hidden="true" />}
                title="Save to storage"
                aria-label="Save to storage"
              />
            )}
            <ActionButton
              onAction={osmFile.downloadOsm}
              variant="ghost"
              icon={<DownloadIcon aria-hidden="true" />}
              title="Download OSM PBF"
              aria-label="Download OSM PBF"
            />
            <ActionButton
              onAction={async () => flyToOsmBounds(osmFile.osmInfo)}
              variant="ghost"
              icon={<MaximizeIcon aria-hidden="true" />}
              title="Fit bounds to file bbox"
              aria-label="Fit bounds to file bbox"
            />
            {onClear && (
              <ActionButton
                onAction={async () => {
                  void (window.confirm("Clear this file from the map?") && onClear());
                }}
                icon={<XIcon aria-hidden="true" />}
                title="Clear file"
                aria-label="Clear file"
                variant="ghost"
              />
            )}
          </>
        }
      />
      <OsmInfoTable
        defaultOpen={false}
        osm={osmFile.osm}
        file={osmFile.file}
        fileInfo={osmFile.fileInfo}
      />
    </>
  );
}

export interface OsmFileMapControlProps {
  files: Array<{
    osmFile: UseOsmFileReturn;
    onClear?: () => Promise<void>;
  }>;
}

export default function OsmFileMapControl({ files }: OsmFileMapControlProps) {
  const isOpen = useAtomValue(osmFileControlIsOpenAtom);
  if (!isOpen) return null;

  // Filter to only show files that are loaded
  const loadedFiles = files.filter((f) => f.osmFile.osm && f.osmFile.osmInfo && f.osmFile.fileInfo);

  return loadedFiles.map((file) => (
    <CustomControl key={file.osmFile.fileInfo?.fileHash} position="top-left">
      <OsmFileCard osmFile={file.osmFile} onClear={file.onClear} />
    </CustomControl>
  ));
}
