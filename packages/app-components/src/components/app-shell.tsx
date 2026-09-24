import { Log } from "@osmix/app-core";
import { ErrorBoundary, LoadingState, Nav } from "@osmix/ui";
import { Provider } from "jotai";
import { type ReactNode, StrictMode, Suspense, useLayoutEffect } from "react";
import { MapProvider } from "react-map-gl/maplibre";

import type { OsmixAppStore } from "../bootstrap.ts";
import type { OsmixAppId } from "../lib/app-origin.ts";
import { AppLinks } from "./app-links.tsx";
import BrowserCheck from "./browser-check.tsx";
import { MapNavControls } from "./map-nav-controls.tsx";
import Status from "./status.tsx";

/** The standard top bar: brand, links to the sibling apps, status, and map controls. */
export function OsmixNav({ current }: { current: OsmixAppId }) {
  return (
    <Nav
      links={
        <>
          <AppLinks current={current} />
          <BrowserCheck />
        </>
      }
      status={<Status />}
      controls={<MapNavControls />}
    />
  );
}

/**
 * Root of every Osmix app: StrictMode, the jotai store, an error boundary, the map provider,
 * and the standard nav above the app content. `app` selects the nav's per-app hue
 * (`--app-hue`, via `data-app` on the document element) and highlights the current app link.
 */
export function OsmixAppShell({
  app,
  store,
  children,
}: {
  app: OsmixAppId;
  store: OsmixAppStore;
  children: ReactNode;
}) {
  useLayoutEffect(() => {
    document.documentElement.dataset.app = app;
  }, [app]);

  return (
    <StrictMode>
      <Provider store={store}>
        <ErrorBoundary onError={(error) => Log.addMessage(error.message, "error")}>
          <MapProvider>
            <div className="flex h-screen w-screen flex-col">
              <OsmixNav current={app} />
              <Suspense fallback={<LoadingState />}>{children}</Suspense>
            </div>
          </MapProvider>
        </ErrorBoundary>
      </Provider>
    </StrictMode>
  );
}
