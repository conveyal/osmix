import { atom, useStore } from "jotai";
import { atomFamily } from "jotai-family";
import type { OsmInfo } from "osmix";
import { useEffect } from "react";

import { osmInfoAtomFamily } from "../state/osm.ts";
import { useOsmixRemote } from "./remote.ts";

export const LOAD_FROM_URL_PARAM = "load";

/** Whether a slot has had its one automatic open this session. */
const attemptedAtomFamily = atomFamily((_osmKey: string) => atom(false));

/**
 * The first time a page with the `osmKey` slot mounts in this session, open a stored dataset
 * named by the `?load=<fileHash>` URL parameter, or fall back to the most recently used stored
 * dataset. A page that mounts again after navigation, or a slot that already holds a dataset,
 * opens nothing. The parameter is removed from the URL once consumed so a reload does not
 * repeat the request.
 */
export function useLoadFromUrl({
  osmKey,
  loadFromStorage,
  onLoaded,
  fallbackToMostRecent = true,
}: {
  osmKey: string;
  loadFromStorage: (storageId: string) => Promise<OsmInfo | null>;
  onLoaded?: (info: OsmInfo) => void;
  fallbackToMostRecent?: boolean;
}) {
  const remote = useOsmixRemote();
  const store = useStore();

  useEffect(() => {
    const attempted = attemptedAtomFamily(osmKey);
    if (store.get(attempted)) return;
    store.set(attempted, true);

    const url = new URL(window.location.href);
    const storageId = url.searchParams.get(LOAD_FROM_URL_PARAM);
    if (storageId) {
      url.searchParams.delete(LOAD_FROM_URL_PARAM);
      window.history.replaceState(window.history.state, "", url);
    }
    if (store.get(osmInfoAtomFamily(osmKey))) return;
    const load = (id: string) =>
      loadFromStorage(id).then((info) => {
        if (info) onLoaded?.(info);
      });

    if (storageId) {
      void load(storageId);
      return;
    }
    if (!fallbackToMostRecent) return;
    void remote.getMostRecentlyUsed().then((mostRecent) => {
      if (mostRecent) return load(mostRecent.fileHash);
    });
  }, [fallbackToMostRecent, loadFromStorage, onLoaded, osmKey, remote, store]);
}
