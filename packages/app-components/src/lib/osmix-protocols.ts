import type { OsmixAppRemote } from "@osmix/app-core";

import { addOsmixPlanProtocol, removeOsmixPlanProtocol } from "./osmix-plan-protocol.ts";
import { addOsmixRasterProtocol, removeOsmixRasterProtocol } from "./osmix-raster-protocol.ts";
import { addOsmixVectorProtocol, removeOsmixVectorProtocol } from "./osmix-vector-protocol.ts";

/**
 * Register the `@osmix/raster`, `@osmix/vector` and `@osmix/plan` MapLibre protocols backed by
 * `remote`. Idempotent; returns a function that unregisters them.
 */
export function registerOsmixProtocols(remote: OsmixAppRemote): () => void {
  addOsmixRasterProtocol(remote);
  addOsmixVectorProtocol(remote);
  addOsmixPlanProtocol(remote);
  return () => {
    removeOsmixRasterProtocol();
    removeOsmixVectorProtocol();
    removeOsmixPlanProtocol();
  };
}
