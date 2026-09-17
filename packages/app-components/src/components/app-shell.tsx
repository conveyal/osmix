import { Log } from "@osmix/app-core";
import { ErrorBoundary } from "@osmix/ui";
import { Provider } from "jotai";
import { type ReactNode, StrictMode, Suspense } from "react";
import { MapProvider } from "react-map-gl/maplibre";

import type { OsmixAppStore } from "../bootstrap.ts";

/**
 * The React wrapper every Osmix app renders inside: strict mode, the app's jotai store, an
 * error boundary that logs, the react-map-gl provider, and the full-height column with the
 * nav on top. Apps that need more providers wrap `children` themselves.
 */
export function OsmixAppShell({
  store,
  nav,
  children,
}: {
  store: OsmixAppStore;
  nav: ReactNode;
  children: ReactNode;
}) {
  return (
    <StrictMode>
      <Provider store={store}>
        <ErrorBoundary
          fallback={<div>Error</div>}
          onError={(error) => Log.addMessage(error.message, "error")}
        >
          <MapProvider>
            <div className="h-screen w-screen flex flex-col">
              {nav}
              <Suspense fallback={<div>Loading...</div>}>{children}</Suspense>
            </div>
          </MapProvider>
        </ErrorBoundary>
      </Provider>
    </StrictMode>
  );
}
