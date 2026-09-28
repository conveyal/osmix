import { Tasks, useTasks } from "@osmix/app-core";
import {
  ErrorBoundary,
  LoadingState,
  Nav,
  SidebarProvider,
  SidebarTrigger,
  sidebarIsOpenAtom,
  TaskLockProvider,
  Toaster,
  TooltipProvider,
} from "@osmix/ui";
import { Provider, useAtom } from "jotai";
import { type ReactNode, StrictMode, Suspense, useLayoutEffect } from "react";
import { MapProvider } from "react-map-gl/maplibre";
import { Link, useLocation } from "wouter";

import type { OsmixAppStore } from "../bootstrap.ts";
import { HOME_PATH, type OsmixRoute, routeForPath } from "../lib/app-pages.ts";
import { ActivityButton } from "./activity-button.tsx";
import { ActivitySheet } from "./activity-sheet.tsx";
import { AppLinks } from "./app-links.tsx";
import BrowserCheck from "./browser-check.tsx";
import { SmallWindowAlert } from "./small-window-alert.tsx";
import { TaskToasts } from "./task-toasts.tsx";

/**
 * The standard top bar: the sidebar trigger (not on Home, which has no sidebar), the brand
 * (a link to Home), links to the pages, the system check, then Activity.
 */
export function OsmixNav({ current }: { current: OsmixRoute | null }) {
  return (
    <Nav
      start={current === "home" ? null : <SidebarTrigger />}
      brandLink={<Link href={HOME_PATH} aria-label="Osmix home" />}
      links={<AppLinks current={current} />}
      end={<BrowserCheck />}
      trailing={<ActivityButton />}
    />
  );
}

/**
 * Root of the Osmix app: StrictMode, the jotai store, an error boundary, the map provider,
 * the task lock, toasts and the Activity sheet, and the standard nav above the app content.
 * The current page (from the location) selects the nav's hue (`--app-hue`, via `data-app` on
 * the document element; Home has none) and highlights its link.
 */
export function OsmixAppShell({ store, children }: { store: OsmixAppStore; children: ReactNode }) {
  const [location] = useLocation();
  const route = routeForPath(location);
  useLayoutEffect(() => {
    const root = document.documentElement;
    if (route && route !== "home") root.dataset.app = route;
    else delete root.dataset.app;
  }, [route]);

  return (
    <StrictMode>
      <Provider store={store}>
        <ErrorBoundary onError={(error) => Tasks.message(error.message, "error")}>
          <MapProvider>
            <TooltipProvider>
              <TaskLock>
                <OsmixSidebarProvider>
                  <OsmixNav current={route} />
                  <SmallWindowAlert />
                  <Suspense fallback={<LoadingState />}>{children}</Suspense>
                </OsmixSidebarProvider>
                <ActivitySheet />
              </TaskLock>
              <TaskToasts />
              <Toaster />
            </TooltipProvider>
          </MapProvider>
        </ErrorBoundary>
      </Provider>
    </StrictMode>
  );
}

/** Disable task-starting controls while a task runs: only one runs at a time. */
function TaskLock({ children }: { children: ReactNode }) {
  const { current } = useTasks();
  return <TaskLockProvider locked={current !== null}>{children}</TaskLockProvider>;
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
