import { installMaplibreWorker, registerOsmixProtocols } from "@osmix/app-components";
import {
  createOsmixAppRemote,
  createThrottledProgressLogger,
  Log,
  type OsmixAppRemote,
  remoteAtom,
} from "@osmix/app-core";
import { ErrorBoundary } from "@osmix/ui";
import { createStore, Provider } from "jotai";
import { StrictMode, Suspense } from "react";
import { createRoot } from "react-dom/client";
import { MapProvider } from "react-map-gl/maplibre";

import { InspectApp } from "./app";
import { InspectNav } from "./nav";

declare global {
  interface Window {
    osmWorker: OsmixAppRemote;
  }
}

async function bootstrap() {
  const rootEl = document.getElementById("root");
  if (!rootEl) throw new Error("Root element not found");

  const store = createStore();
  const remote = await createOsmixAppRemote({
    onProgress: createThrottledProgressLogger(Log),
  });
  store.set(remoteAtom, remote);
  window.osmWorker = remote;
  registerOsmixProtocols(remote);
  installMaplibreWorker();

  createRoot(rootEl).render(
    <StrictMode>
      <Provider store={store}>
        <ErrorBoundary
          fallback={<div>Error</div>}
          onError={(error) => Log.addMessage(error.message, "error")}
        >
          <MapProvider>
            <div className="h-screen w-screen flex flex-col">
              <InspectNav />
              <Suspense fallback={<div>Loading...</div>}>
                <InspectApp />
              </Suspense>
            </div>
          </MapProvider>
        </ErrorBoundary>
      </Provider>
    </StrictMode>,
  );
}

void bootstrap();
