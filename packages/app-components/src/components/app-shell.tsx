import { Log } from "@osmix/app-core";
import {
  ErrorBoundary,
  LoadingState,
  Nav,
  SidebarProvider,
  SidebarTrigger,
  sidebarIsOpenAtom,
  TooltipProvider,
} from "@osmix/ui";
import { Provider, useAtom } from "jotai";
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
      start={<SidebarTrigger />}
      links={<AppLinks current={current} />}
      status={<Status />}
      controls={<MapNavControls />}
      end={<BrowserCheck />}
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
            <TooltipProvider>
              <OsmixSidebarProvider>
                <OsmixNav current={app} />
                <Suspense fallback={<LoadingState />}>{children}</Suspense>
              </OsmixSidebarProvider>
            </TooltipProvider>
          </MapProvider>
        </ErrorBoundary>
      </Provider>
    </StrictMode>
  );
}

/** The page frame: the nav above a sidebar/map row. The sidebar's open state persists. */
function OsmixSidebarProvider({ children }: { children: ReactNode }) {
  const [open, setOpen] = useAtom(sidebarIsOpenAtom);
  return (
    <SidebarProvider open={open} onOpenChange={setOpen} className="h-svh min-h-0 flex-col">
      {children}
    </SidebarProvider>
  );
}
