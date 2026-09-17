import type { OsmixAppRemote } from "@osmix/app-core";
import { addProtocol, type GetResourceResponse, removeProtocol } from "maplibre-gl";
import type { Tile } from "osmix";

import { VECTOR_PROTOCOL_NAME } from "../constants.ts";

const VECTOR_URL_PATTERN = /^@osmix\/vector:\/\/([^/]+)\/(\d+)\/(\d+)\/(\d+)\.mvt$/;

let registered = false;

export function osmixIdToTileUrl(osmId: string) {
  return `${VECTOR_PROTOCOL_NAME}://${encodeURIComponent(osmId)}/{z}/{x}/{y}.mvt`;
}

export function addOsmixVectorProtocol(remote: OsmixAppRemote) {
  if (registered) return;
  addProtocol(
    VECTOR_PROTOCOL_NAME,
    async (req, abortController): Promise<GetResourceResponse<ArrayBuffer | null>> => {
      const match = VECTOR_URL_PATTERN.exec(req.url);
      if (!match) throw new Error(`Bad @osmix/vector URL: ${req.url}`);
      const [, osmId, zStr, xStr, yStr] = match;
      const tileIndex: Tile = [+xStr, +yStr, +zStr];
      const id = decodeURIComponent(osmId);
      const data = await remote.runWithWorker((worker) => worker.getVectorTile(id, tileIndex), {
        lane: "compute",
        retry: "once",
        signal: abortController.signal,
      });

      return {
        data: abortController.signal.aborted ? null : data,
        cacheControl: "no-cache",
      };
    },
  );
  registered = true;
}

export function removeOsmixVectorProtocol() {
  if (!registered) return;
  removeProtocol(VECTOR_PROTOCOL_NAME);
  registered = false;
}
