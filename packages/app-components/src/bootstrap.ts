import {
  createOsmixAppRemote,
  createThrottledProgressLogger,
  Log,
  type OsmixAppRemote,
  type OsmixAppRemoteOptions,
  remoteAtom,
} from "@osmix/app-core";
import { createStore } from "jotai";

import { installMaplibreWorker } from "./lib/maplibre-worker.ts";
import { registerOsmixProtocols } from "./lib/osmix-protocols.ts";

export type OsmixAppStore = ReturnType<typeof createStore>;

export interface OsmixAppRuntime {
  store: OsmixAppStore;
  remote: OsmixAppRemote;
}

/**
 * Create the runtime every Osmix app needs before it renders: a jotai store, the worker remote
 * (set on `remoteAtom`), the MapLibre tile protocols and the MapLibre worker URL. Progress
 * messages go to the shared `Log` unless `onProgress` is given.
 *
 * Deliberately stops there. Apps subscribe to atoms, expose the remote for tests, and render
 * with `OsmixAppShell` themselves, so app-specific wiring stays in the app.
 */
export async function createOsmixAppRuntime(
  options: OsmixAppRemoteOptions = {},
): Promise<OsmixAppRuntime> {
  const store = createStore();
  const remote = await createOsmixAppRemote({
    onProgress: createThrottledProgressLogger(Log),
    ...options,
  });
  store.set(remoteAtom, remote);
  registerOsmixProtocols(remote);
  installMaplibreWorker();
  return { store, remote };
}
