import { searchControlIsOpenAtom } from "@osmix/app-core";
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
import { useAtomValue, useSetAtom } from "jotai";
import { SearchIcon } from "lucide-react";
import { useState, useTransition } from "react";
import type { MapInstance } from "react-map-gl/maplibre";

import { nominatimPlaceAtom } from "../state/nominatim.ts";
import CustomControl from "./custom-control.tsx";
import { MapPanelHeader } from "./map-panel-header.tsx";

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

export default function NominatimSearchControl() {
  const isOpen = useAtomValue(searchControlIsOpenAtom);
  if (!isOpen) return null;
  return (
    <CustomControl position="top-right">
      <NominatimSearchPanel />
    </CustomControl>
  );
}

/** `CustomControl` passes `map` to its child element. */
function NominatimSearchPanel({ map }: { map?: MapInstance }) {
  return (
    <>
      <MapPanelHeader icon={<SearchIcon aria-hidden="true" />} title="Search places" />
      <NominatimSearch map={map} />
    </>
  );
}

export function NominatimSearch({
  map,
  onPlaceResolved,
}: {
  map?: MapInstance;
  /**
   * Called after the map is focused on the chosen result (bbox or center). The result is also
   * published to `nominatimPlaceAtom`.
   */
  onPlaceResolved?: (result: NominatimResult) => void;
}) {
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
        const url = new URL(NOMINATIM_ENDPOINT);
        url.searchParams.set("format", "jsonv2");
        url.searchParams.set("limit", "10");
        url.searchParams.set("q", trimmed);
        const bounds = map?.getBounds();
        if (bounds) url.searchParams.set("viewbox", bounds.toArray().flat().join(","));

        const response = await fetch(url.toString(), {
          headers: {
            Accept: "application/json",
          },
        });
        if (!response.ok) {
          throw Error(`Nominatim request failed (${response.status})`);
        }

        const data = (await response.json()) as NominatimResult[];
        setResults(Array.isArray(data) ? data : []);
        setSearched(true);
      } catch (err) {
        console.error(err);
        setError("Place search failed. Check your connection and try again.");
        setResults([]);
      }
    });
  };

  const resolvePlace = (result: NominatimResult) => {
    setPlace(result);
    onPlaceResolved?.(result);
  };

  const handleSelect = (result: NominatimResult) => {
    setQuery(result.display_name);
    setResults([]);
    setSearched(false);

    if (!map) {
      resolvePlace(result);
      return;
    }

    const bbox = result.boundingbox?.map(Number);
    if (bbox && bbox.length === 4 && bbox.every(Number.isFinite)) {
      const [latSouth, latNorth, lonWest, lonEast] = bbox as [number, number, number, number];
      // Clamp to a sensible padding so we don't zoom too far out
      map.fitBounds(
        [
          [lonWest, latSouth],
          [lonEast, latNorth],
        ],
        { padding: 100, maxDuration: 100 },
      );
      resolvePlace(result);
      return;
    }

    const lat = Number(result.lat);
    const lon = Number(result.lon);
    if (Number.isFinite(lat) && Number.isFinite(lon)) {
      const currentZoom = map.getZoom?.() ?? 12;
      const targetZoom = Math.max(currentZoom, 14);
      map.flyTo({
        center: [lon, lat],
        zoom: targetZoom,
        maxDuration: 100,
      });
    }
    resolvePlace(result);
  };

  return (
    <div className="flex min-h-0 flex-col">
      <form
        className="shrink-0 px-inset py-2"
        onSubmit={(e) => {
          e.preventDefault();
          search(query);
        }}
      >
        <InputGroup>
          <InputGroupInput
            // Focus once when the panel opens. (An inline ref callback re-ran on every render,
            // and map panels re-render on every camera move, so it stole focus.)
            autoFocus
            onFocus={(e) => e.target.select()}
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Search for a place"
            aria-label="Search for a place"
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
        <Alert variant="destructive" className="mx-inset mb-2">
          {error}
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
                  onClick={() => handleSelect(result)}
                >
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
