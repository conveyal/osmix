import type { OsmInfo } from "osmix";
import { useEffect, useRef } from "react";

import { useOsmixRemote } from "./remote.ts";

export const LOAD_FROM_URL_PARAM = "load";

/**
 * On first mount, open a stored dataset named by the `?load=<fileHash>` URL parameter, or fall
 * back to the most recently used stored dataset. The parameter is removed from the URL once
 * consumed so a reload does not repeat the request.
 */
export function useLoadFromUrl({
  loadFromStorage,
  onLoaded,
  fallbackToMostRecent = true,
}: {
  loadFromStorage: (storageId: string) => Promise<OsmInfo | null>;
  onLoaded?: (info: OsmInfo) => void;
  fallbackToMostRecent?: boolean;
}) {
  const remote = useOsmixRemote();
  const attempted = useRef(false);

  useEffect(() => {
    if (attempted.current) return;
    attempted.current = true;

    const url = new URL(window.location.href);
    const storageId = url.searchParams.get(LOAD_FROM_URL_PARAM);
    const load = (id: string) =>
      loadFromStorage(id).then((info) => {
        if (info) onLoaded?.(info);
      });

    if (storageId) {
      url.searchParams.delete(LOAD_FROM_URL_PARAM);
      window.history.replaceState(window.history.state, "", url);
      void load(storageId);
      return;
    }
    if (!fallbackToMostRecent) return;
    void remote.getMostRecentlyUsed().then((mostRecent) => {
      if (mostRecent) return load(mostRecent.fileHash);
    });
  }, [fallbackToMostRecent, loadFromStorage, onLoaded, remote]);
}
