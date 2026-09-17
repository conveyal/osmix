import type { OsmixAppRemote } from "@osmix/app-core";

import { addOsmixRasterProtocol, removeOsmixRasterProtocol } from "./osmix-raster-protocol.ts";
import { addOsmixVectorProtocol, removeOsmixVectorProtocol } from "./osmix-vector-protocol.ts";

/**
 * Register the `@osmix/raster` and `@osmix/vector` MapLibre protocols backed by `remote`.
 * Idempotent; returns a function that unregisters both.
 */
export function registerOsmixProtocols(remote: OsmixAppRemote): () => void {
  addOsmixRasterProtocol(remote);
  addOsmixVectorProtocol(remote);
  return () => {
    removeOsmixRasterProtocol();
    removeOsmixVectorProtocol();
  };
}
