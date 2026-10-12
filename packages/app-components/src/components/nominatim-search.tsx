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
import type { LngLatBounds } from "maplibre-gl";
import { useState, useTransition } from "react";
import type { MapRef } from "react-map-gl/maplibre";

import { type MapPadding, paddingOffset, useMap, useMapPadding } from "../hooks/map.ts";
import { nominatimPlaceAtom } from "../state/nominatim.ts";

export type NominatimResult = {
  addresstype: string;
  address: Record<string, string>;
  place_id: number;
  display_name: string;
  boundingbox?: [string, string, string, string];
  lat: string;
  lon: string;
  type?: string;
} & Record<string, unknown>;

const NOMINATIM_ENDPOINT = "https://nominatim.openstreetmap.org/search";

/** Query Nominatim for places matching `query`, preferring results inside `bounds`. */
export async function searchNominatim(
  query: string,
  bounds?: LngLatBounds | null,
): Promise<NominatimResult[]> {
  const url = new URL(NOMINATIM_ENDPOINT);
  url.searchParams.set("format", "jsonv2");
  url.searchParams.set("limit", "10");
  url.searchParams.set("q", query);
  if (bounds) url.searchParams.set("viewbox", bounds.toArray().flat().join(","));

  const response = await fetch(url.toString(), { headers: { Accept: "application/json" } });
  if (!response.ok) throw Error(`Nominatim request failed (${response.status})`);

  const data = (await response.json()) as NominatimResult[];
  return Array.isArray(data) ? data : [];
}

/**
 * Move the map to a result: fit its bounding box with `padding`, or fly to its point at street
 * zoom, offset so it centres in the padded area (`useMapPadding()` supplies both).
 */
export function focusNominatimResult(
  map: MapRef,
  result: NominatimResult,
  padding: MapPadding,
): void {
  const bbox = result.boundingbox?.map(Number);
  if (bbox && bbox.length === 4 && bbox.every(Number.isFinite)) {
    const [latSouth, latNorth, lonWest, lonEast] = bbox as [number, number, number, number];
    map.fitBounds(
      [
        [lonWest, latSouth],
        [lonEast, latNorth],
      ],
      { padding, maxDuration: 100 },
    );
    return;
  }

  const lat = Number(result.lat);
  const lon = Number(result.lon);
  if (Number.isFinite(lat) && Number.isFinite(lon)) {
    const targetZoom = Math.max(map.getZoom(), 14);
    map.flyTo({
      center: [lon, lat],
      zoom: targetZoom,
      offset: paddingOffset(padding),
      maxDuration: 100,
    });
  }
}

/**
 * A place search control backed by Nominatim: a query field with a bordered result list under
 * it, and the map moves to the chosen place. It carries no edge padding of its own, so it sits
 * in a form like any other field (Extract's step 2). The result is published to
 * `nominatimPlaceAtom`. The map search has its own panel and shares only `searchNominatim` and
 * `focusNominatimResult`. The field's accessible name is `label`; pass `inputId` to point a
 * visible `FieldLabel` at it.
 */
export function NominatimSearch({
  onPlaceResolved,
  autoFocus = false,
  inputId,
  label = "Search for a place",
}: {
  /**
   * Called after the map is focused on the chosen result (bbox or center). The result is also
   * published to `nominatimPlaceAtom`.
   */
  onPlaceResolved?: (result: NominatimResult) => void;
  /** Focus the query field on mount. Off by default so a remount does not steal focus. */
  autoFocus?: boolean;
  /** The query field's DOM id, for a visible label's `htmlFor`. */
  inputId?: string;
  /** The query field's accessible name and placeholder. */
  label?: string;
}) {
  const map = useMap();
  const mapPadding = useMapPadding();
  const setPlace = useSetAtom(nominatimPlaceAtom);
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<NominatimResult[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [searched, setSearched] = useState(false);
  const [isTransitioning, startTransition] = useTransition();

  const search = (value: string) => {
    setError(null);
    setResults([]);
    setSearched(false);
    const trimmed = value.trim();
    if (!trimmed) return;
    startTransition(async () => {
      try {
        setResults(await searchNominatim(trimmed, map?.getBounds()));
        setSearched(true);
      } catch (err) {
        console.error(err);
        setError("Place search failed. Check your connection and try again.");
        setResults([]);
      }
    });
  };

  const handleSelect = (result: NominatimResult) => {
    setQuery(result.display_name);
    setResults([]);
    setSearched(false);
    if (map) focusNominatimResult(map, result, mapPadding(100));
    setPlace(result);
    onPlaceResolved?.(result);
  };

  return (
    <div className="flex min-h-0 flex-col gap-2">
      <form
        className="shrink-0"
        onSubmit={(e) => {
          e.preventDefault();
          search(query);
        }}
      >
        <InputGroup>
          <InputGroupInput
            id={inputId}
            autoFocus={autoFocus}
            onFocus={(e) => e.target.select()}
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder={label}
            aria-label={label}
          />
          <InputGroupAddon align="inline-end">
            <InputGroupButton
              type="submit"
              size="icon-xs"
              aria-label="Search"
              variant="ghost"
              disabled={isTransitioning}
            >
              {isTransitioning ? <Spinner /> : <SearchIcon aria-hidden="true" />}
            </InputGroupButton>
          </InputGroupAddon>
        </InputGroup>
      </form>

      {error ? (
        <Alert variant="destructive">{error}</Alert>
      ) : isTransitioning ? (
        <div className="flex items-center gap-2 text-muted-foreground">
          <Spinner />
          Searching…
        </div>
      ) : searched && results.length === 0 ? (
        <EmptyState className="p-0">No places found</EmptyState>
      ) : null}

      {results.length > 0 && (
        <ScrollArea className="max-h-60 border">
          <ul className="flex flex-col p-1">
            {results.map((result) => (
              <li key={result.place_id}>
                <Button variant="ghost" size="row" onClick={() => handleSelect(result)}>
                  {result.display_name}
                </Button>
              </li>
            ))}
          </ul>
        </ScrollArea>
      )}
    </div>
  );
}
