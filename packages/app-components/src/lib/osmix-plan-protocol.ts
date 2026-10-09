import type { OsmixAppRemote } from "@osmix/app-core";
import { addProtocol, type GetResourceResponse, removeProtocol } from "maplibre-gl";
import type { Tile } from "osmix";

import { PLAN_PROTOCOL_NAME } from "../constants.ts";

const PLAN_URL_PATTERN = /^@osmix\/plan:\/\/([^/]+)\/\d+\/(\d+)\/(\d+)\/(\d+)\.mvt$/;

let registered = false;

/**
 * Tile URL template for the merge plan open on `baseOsmId`. A plan's outcomes change as it is
 * decided while the base id stays the same, so each `revision` gets new URLs and fresh tiles.
 */
export function planTileUrl(baseOsmId: string, revision: number) {
  return `${PLAN_PROTOCOL_NAME}://${encodeURIComponent(baseOsmId)}/${revision}/{z}/{x}/{y}.mvt`;
}

export function addOsmixPlanProtocol(remote: OsmixAppRemote) {
  if (registered) return;
  addProtocol(
    PLAN_PROTOCOL_NAME,
    async (req, abortController): Promise<GetResourceResponse<ArrayBuffer | null>> => {
      const match = PLAN_URL_PATTERN.exec(req.url);
      if (!match) throw new Error(`Bad @osmix/plan URL: ${req.url}`);
      const [, baseOsmId, zStr, xStr, yStr] = match;
      const tile: Tile = [+xStr, +yStr, +zStr];
      const data = await remote.getMergePlanTile(
        decodeURIComponent(baseOsmId),
        tile,
        abortController.signal,
      );
      return {
        data: abortController.signal.aborted ? null : data,
        cacheControl: "no-cache",
      };
    },
  );
  registered = true;
}

export function removeOsmixPlanProtocol() {
  if (!registered) return;
  removeProtocol(PLAN_PROTOCOL_NAME);
  registered = false;
}
