import { layerControlIsOpenAtom } from "@osmix/app-core";
import {
  Button,
  cn,
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
  EmptyState,
  IconButton,
  Input,
} from "@osmix/ui";
import { useAtomValue } from "jotai";
import {
  ChevronDownIcon,
  EyeIcon,
  EyeOffIcon,
  FolderIcon,
  FolderOpenIcon,
  LayersIcon,
} from "lucide-react";
import { useCallback, useEffectEvent, useMemo, useState, useSyncExternalStore } from "react";

import { APPID } from "../constants.ts";
import { useMap } from "../hooks/map.ts";
import CustomControl from "./custom-control.tsx";
import { MapPanelBody, MapPanelHeader } from "./map-panel-header.tsx";

type LayerInfo = {
  id: string;
  type: string;
  visible: boolean;
};

type LayerGroup = {
  id: string;
  name: string;
  layers: LayerInfo[];
};

export default function MapLayerControl() {
  const isOpen = useAtomValue(layerControlIsOpenAtom);
  if (!isOpen) return null;
  return (
    <CustomControl position="bottom-right" width="narrow">
      <MapLayers />
    </CustomControl>
  );
}

type MapHandle = NonNullable<ReturnType<typeof useMap>>;

const NO_LAYERS: LayerInfo[] = [];
const layerCache = new WeakMap<MapHandle, { key: string; layers: LayerInfo[] }>();

/** Read the style's layers, reusing the previous array while nothing changed. */
function readMapLayers(map: MapHandle): LayerInfo[] {
  const layers: LayerInfo[] = (map.getStyle()?.layers ?? []).map((layer) => ({
    id: layer.id,
    type: layer.type,
    visible: map.getLayoutProperty(layer.id, "visibility") !== "none",
  }));
  const key = layers
    .map((layer) => `${layer.id}\u0000${layer.type}\u0000${layer.visible}`)
    .join("\n");
  const cached = layerCache.get(map);
  if (cached?.key === key) return cached.layers;
  layerCache.set(map, { key, layers });
  return layers;
}

/** Subscribe to the map's style so the layer list follows style loads and visibility changes. */
function useMapLayers(map: MapHandle | null): LayerInfo[] {
  const subscribe = useCallback(
    (onChange: () => void) => {
      if (!map) return () => {};
      map.on("styledata", onChange);
      map.on("load", onChange);
      return () => {
        map.off("styledata", onChange);
        map.off("load", onChange);
      };
    },
    [map],
  );
  const getSnapshot = useCallback(() => (map ? readMapLayers(map) : NO_LAYERS), [map]);
  return useSyncExternalStore(subscribe, getSnapshot);
}

export function MapLayers() {
  const map = useMap();
  const layers = useMapLayers(map);
  const [searchQuery, setSearchQuery] = useState("");
  const [open, setOpen] = useState(true);

  // Group layers by prefix
  const groups = useMemo((): LayerGroup[] => {
    const osmixLayers: LayerInfo[] = [];
    const basemapLayers: LayerInfo[] = [];

    for (const layer of layers) {
      if (layer.id.startsWith(APPID)) {
        osmixLayers.push(layer);
      } else {
        basemapLayers.push(layer);
      }
    }

    return [
      { id: "osmix", name: "Osmix", layers: osmixLayers },
      { id: "basemap", name: "Basemap", layers: basemapLayers },
    ];
  }, [layers]);

  // Filter layers by search query
  const filteredGroups = useMemo((): LayerGroup[] => {
    if (!searchQuery.trim()) return groups;
    const query = searchQuery.toLowerCase();
    return groups.map((group) => ({
      ...group,
      layers: group.layers.filter((layer) => layer.id.toLowerCase().includes(query)),
    }));
  }, [groups, searchQuery]);

  // Toggle layer visibility
  const toggleLayerVisibility = useEffectEvent((layerId: string, currentlyVisible: boolean) => {
    const newVisibility = currentlyVisible ? "none" : "visible";
    map?.getMap().setLayoutProperty(layerId, "visibility", newVisibility);
  });

  // Toggle all layers in a group
  const toggleGroupVisibility = useEffectEvent((group: LayerGroup, show: boolean) => {
    const visibility = show ? "visible" : "none";
    for (const layer of group.layers) {
      map?.getMap().setLayoutProperty(layer.id, "visibility", visibility);
    }
  });

  if (!map) return null;

  const matchCount = filteredGroups.reduce((count, group) => count + group.layers.length, 0);

  return (
    <Collapsible open={open} onOpenChange={setOpen} className="flex min-h-0 flex-col">
      <MapPanelHeader
        icon={<LayersIcon aria-hidden="true" />}
        title="Layers"
        detail={layers.length.toLocaleString()}
        actions={
          <IconButton
            label="Toggle layer list"
            aria-expanded={open}
            onClick={() => setOpen((o) => !o)}
            icon={
              <ChevronDownIcon
                aria-hidden="true"
                className={cn("transition-transform", open && "rotate-180")}
              />
            }
          />
        }
      />

      <CollapsibleContent className="flex min-h-0 flex-col">
        <div className="shrink-0 border-b px-inset py-2">
          <Input
            type="search"
            placeholder="Search layers…"
            aria-label="Search layers"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
          />
        </div>

        <MapPanelBody>
          {matchCount === 0 ? (
            <EmptyState>No layers match the search</EmptyState>
          ) : (
            filteredGroups.map((group) => (
              <LayerGroupComponent
                key={group.id}
                group={group}
                onToggleLayer={toggleLayerVisibility}
                onToggleGroup={toggleGroupVisibility}
              />
            ))
          )}
        </MapPanelBody>
      </CollapsibleContent>
    </Collapsible>
  );
}

function LayerGroupComponent({
  group,
  onToggleLayer,
  onToggleGroup,
}: {
  group: LayerGroup;
  onToggleLayer: (layerId: string, currentlyVisible: boolean) => void;
  onToggleGroup: (group: LayerGroup, show: boolean) => void;
}) {
  const visibleCount = group.layers.filter((l) => l.visible).length;
  const allVisible = visibleCount === group.layers.length;
  const noneVisible = visibleCount === 0;

  return (
    <Collapsible>
      <div className="flex items-center gap-1 pr-1">
        <CollapsibleTrigger
          render={
            <Button variant="ghost" size="sm" className="group min-w-0 flex-1 justify-start" />
          }
        >
          <ChevronDownIcon
            aria-hidden="true"
            className="transition-transform group-data-panel-open:rotate-180"
          />
          <FolderIcon aria-hidden="true" className="group-data-panel-open:hidden" />
          <FolderOpenIcon aria-hidden="true" className="hidden group-data-panel-open:block" />
          <span className="truncate">{group.name}</span>
          <span className="ml-auto font-mono text-muted-foreground tabular-nums">
            {visibleCount}/{group.layers.length}
          </span>
        </CollapsibleTrigger>
        <IconButton
          onClick={() => onToggleGroup(group, noneVisible || !allVisible)}
          label={allVisible ? `Hide all ${group.name} layers` : `Show all ${group.name} layers`}
          icon={
            allVisible ? (
              <EyeIcon aria-hidden="true" />
            ) : noneVisible ? (
              <EyeOffIcon aria-hidden="true" className="text-muted-foreground" />
            ) : (
              <EyeIcon aria-hidden="true" className="text-muted-foreground" />
            )
          }
        />
      </div>
      <CollapsibleContent className="flex flex-col border-t bg-muted/50">
        {group.layers.map((layer) => (
          <Button
            key={layer.id}
            className="w-full justify-start"
            onClick={() => onToggleLayer(layer.id, layer.visible)}
            title={layer.visible ? "Hide layer" : "Show layer"}
            aria-pressed={layer.visible}
            variant="ghost"
            size="xs"
          >
            {layer.visible ? (
              <EyeIcon aria-hidden="true" />
            ) : (
              <EyeOffIcon aria-hidden="true" className="text-muted-foreground" />
            )}
            <span className="flex-1 truncate text-left font-mono">{layer.id}</span>
            <span className="shrink-0 text-muted-foreground">{layer.type}</span>
          </Button>
        ))}
      </CollapsibleContent>
    </Collapsible>
  );
}
