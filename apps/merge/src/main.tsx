import { installMaplibreWorker, registerOsmixProtocols } from "@osmix/app-components";
import {
  createOsmixAppRemote,
  createThrottledProgressLogger,
  Log,
  type OsmixAppRemote,
  osmDatasetVersionAtomFamily,
  remoteAtom,
} from "@osmix/app-core";
import { ErrorBoundary } from "@osmix/ui";
import { createStore, Provider } from "jotai";
import { StrictMode, Suspense } from "react";
import { createRoot } from "react-dom/client";
import { MapProvider } from "react-map-gl/maplibre";
import { BrowserRouter, Outlet, Route, Routes } from "react-router";

import MergeNav from "./components/nav";
import MergePage from "./pages/merge";
import { BASE_OSM_KEY, PATCH_OSM_KEY } from "./settings";
import { updateMergeOutcomeAtom } from "./state/merge-outcome";

declare global {
  interface Window {
    osmWorker: OsmixAppRemote;
  }
}

function RootLayout() {
  return (
    <MapProvider>
      <div className="h-screen w-screen flex flex-col">
        <MergeNav />
        <Suspense fallback={<div>Loading...</div>}>
          <Outlet />
        </Suspense>
      </div>
    </MapProvider>
  );
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

  // Replacing or clearing either merge input invalidates the merge outcome.
  for (const osmKey of [BASE_OSM_KEY, PATCH_OSM_KEY]) {
    store.sub(osmDatasetVersionAtomFamily(osmKey), () => {
      store.set(updateMergeOutcomeAtom, { type: "reset" });
    });
  }

  createRoot(rootEl).render(
    <StrictMode>
      <Provider store={store}>
        <ErrorBoundary
          fallback={<div>Error</div>}
          onError={(error) => Log.addMessage(error.message, "error")}
        >
          <BrowserRouter>
            <Routes>
              <Route path={"/"} element={<RootLayout />}>
                <Route path="" element={<MergePage />} />
                <Route path="extract" element={<MergePage />} />
              </Route>
            </Routes>
          </BrowserRouter>
        </ErrorBoundary>
      </Provider>
    </StrictMode>,
  );
}

void bootstrap();
