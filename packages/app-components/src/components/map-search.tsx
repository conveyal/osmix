import {
  Alert,
  Button,
  EmptyState,
  InputGroup,
  InputGroupAddon,
  InputGroupButton,
  InputGroupInput,
  ScrollArea,
  Spinner,
} from "@osmix/ui";
import { useSetAtom } from "jotai";
import { SearchIcon } from "lucide-react";
import { useState, useTransition } from "react";

import { useMap, useMapPadding, useSelectAndFlyToEntity } from "../hooks/map.ts";
import { type EntityQuery, getOsmixEntityByStringId, parseEntityQuery } from "../lib/entity-id.ts";
import { nominatimPlaceAtom } from "../state/nominatim.ts";
import { exitRoutingModeAtom } from "../state/routing.ts";
import { useMapDatasets } from "./map-datasets.tsx";
import { MapPanel, useMapAnnounce, useMapOverlayAction } from "./map-overlay.tsx";
import {
  focusNominatimResult,
  type NominatimResult,
  searchNominatim,
} from "./nominatim-search.tsx";

/**
 * The `data-slot` of the inspector's title element. The search moves focus there after it
 * selects an entity, so the inspector must give its title this slot and `tabIndex={-1}`.
 */
export const MAP_INSPECTOR_TITLE_SLOT = "map-inspector-title";

/** The DOM id of the toolbar button that opens the search panel with `panelId`. */
export function mapSearchToggleId(panelId: string): string {
  return `${panelId}-toggle`;
}

function focusById(id: string): boolean {
  const element = document.getElementById(id);
  if (!element) return false;
  element.focus();
  return true;
}

/**
 * Move focus to the inspector title once it has rendered (the selection that opens it is
 * committed before the next frame). Falls back to `fallbackId` when there is no inspector.
 */
function focusMapInspectorTitle(fallbackId: string): void {
  requestAnimationFrame(() => {
    const title = document.querySelector<HTMLElement>(`[data-slot="${MAP_INSPECTOR_TITLE_SLOT}"]`);
    if (title) {
      title.focus();
      return;
    }
    focusById(fallbackId);
  });
}

/**
 * The map search panel, next to the toolbar while `open`. One field takes either a place name
 * (looked up on Nominatim, biased to the current view) or an entity reference (`node/123`,
 * `way 123`, `r-5`); an entity is looked up in each loaded dataset in order, selected and flown
 * to. `id` is the panel's DOM id, which the toolbar's "Open map search" button names in
 * `aria-controls`; closing returns focus to that button (`mapSearchToggleId(id)`). Esc closes
 * it, from the field or through the overlay's Esc stack.
 */
export function MapSearch({
  id,
  open,
  onClose,
}: {
  id: string;
  open: boolean;
  onClose: () => void;
}) {
  const close = () => {
    onClose();
    focusById(mapSearchToggleId(id));
  };
  useMapOverlayAction("search", open, close);
  if (!open) return null;
  return <MapSearchPanel id={id} onClose={close} onEntitySelected={onClose} />;
}

/** Mounted only while the search is open, so its query and results reset on close. */
function MapSearchPanel({
  id,
  onClose,
  onEntitySelected,
}: {
  id: string;
  /** Close and return focus to the toolbar button. */
  onClose: () => void;
  /** Close without moving focus; the caller sends it to the inspector. */
  onEntitySelected: () => void;
}) {
  const map = useMap();
  const mapPadding = useMapPadding();
  const datasets = useMapDatasets();
  const selectAndFlyToEntity = useSelectAndFlyToEntity();
  const exitRouting = useSetAtom(exitRoutingModeAtom);
  const setPlace = useSetAtom(nominatimPlaceAtom);
  const announce = useMapAnnounce();
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<NominatimResult[]>([]);
  const [searched, setSearched] = useState(false);
  const [miss, setMiss] = useState<EntityQuery | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isTransitioning, startTransition] = useTransition();

  const selectEntity = (entityQuery: EntityQuery) => {
    const eid = `${entityQuery.type}/${entityQuery.id}`;
    for (const dataset of datasets) {
      const entity = getOsmixEntityByStringId(dataset.osm, eid);
      if (!entity) continue;
      // Leave the routing tool so the entity view opens (route mode would keep it hidden).
      exitRouting();
      // Focus the toolbar button before selecting: the inspector records what had focus when
      // it opened, so closing it later returns focus to the search button, not the map.
      focusById(mapSearchToggleId(id));
      selectAndFlyToEntity(dataset.osm, entity);
      // The inspector announces the selection; announcing here too would read it twice.
      onEntitySelected();
      focusMapInspectorTitle(mapSearchToggleId(id));
      return;
    }
    setMiss(entityQuery);
    announce(
      `No ${entityQuery.type} ${entityQuery.id} in the loaded data. Check the ID, or open the dataset that contains it`,
    );
  };

  const searchPlaces = (value: string) => {
    startTransition(async () => {
      try {
        const found = await searchNominatim(value, map?.getBounds());
        setResults(found);
        setSearched(true);
        if (found.length === 0) announce("No places found");
      } catch (err) {
        console.error(err);
        setError("Place search failed. Check your connection and try again.");
      }
    });
  };

  const submit = () => {
    setError(null);
    setMiss(null);
    setResults([]);
    setSearched(false);
    const trimmed = query.trim();
    if (!trimmed) return;
    const entityQuery = parseEntityQuery(trimmed);
    if (entityQuery) selectEntity(entityQuery);
    else searchPlaces(trimmed);
  };

  const selectPlace = (result: NominatimResult) => {
    if (map) focusNominatimResult(map, result, mapPadding(100));
    setPlace(result);
    onClose();
  };

  return (
    <MapPanel
      id={id}
      data-slot="map-search"
      role="search"
      aria-label="Map search"
      className="min-w-0 flex-1"
    >
      <form
        className="shrink-0 p-1"
        onSubmit={(e) => {
          e.preventDefault();
          submit();
        }}
      >
        <InputGroup>
          <InputGroupInput
            autoFocus
            onFocus={(e) => e.target.select()}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => {
              if (e.key !== "Escape") return;
              e.preventDefault();
              onClose();
            }}
            placeholder="Place, or node/…, way/…, relation/…"
            aria-label="Place or entity ID"
          />
          <InputGroupAddon align="inline-end">
            <InputGroupButton
              type="submit"
              size="icon-xs"
              aria-label="Run search"
              variant="ghost"
              disabled={isTransitioning}
            >
              {isTransitioning ? <Spinner /> : <SearchIcon aria-hidden="true" />}
            </InputGroupButton>
          </InputGroupAddon>
        </InputGroup>
      </form>

      {error ? (
        <Alert variant="destructive" className="mx-1 mb-1">
          {error}
        </Alert>
      ) : miss ? (
        // The miss is announced through the overlay's live region; a status role here would
        // read it twice.
        <Alert variant="warning" className="mx-1 mb-1">
          No {miss.type} {miss.id} in the loaded data. Check the ID, or open the dataset that
          contains it
        </Alert>
      ) : isTransitioning ? (
        <div className="flex items-center gap-2 px-inset pb-2 text-muted-foreground">
          <Spinner />
          Searching…
        </div>
      ) : searched && results.length === 0 ? (
        <EmptyState className="pt-0">No places found</EmptyState>
      ) : null}

      {results.length > 0 && (
        <ScrollArea className="max-h-60 border-t">
          <ul className="flex flex-col p-1">
            {results.map((result) => (
              <li key={result.place_id}>
                <Button
                  variant="ghost"
                  className="h-auto w-full justify-start px-2 py-1.5 text-left whitespace-normal"
                  onClick={() => selectPlace(result)}
                >
                  {result.display_name}
                </Button>
              </li>
            ))}
          </ul>
        </ScrollArea>
      )}
    </MapPanel>
  );
}
