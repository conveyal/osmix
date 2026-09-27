import type { ReactNode } from "react";

import { setToastAnchor } from "../state/layout.ts";
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarInset,
  SidebarRail,
} from "./ui/sidebar.tsx";

/**
 * The row under the nav (and the small-window banner): `AppSidebar` then `MapContent`. The
 * sidebar is positioned inside this row, so it starts wherever the row does.
 */
export function Main({ children }: { children: ReactNode }) {
  return (
    <div data-slot="main" className="relative flex min-h-0 w-full flex-1 flex-row overflow-hidden">
      {children}
    </div>
  );
}

/**
 * The app sidebar: shadcn's `Sidebar`, below the nav, collapsing offcanvas (nav trigger, the
 * edge rail, or Cmd/Ctrl+B). Children scroll in one `ScrollArea` with the
 * inset gutter and `gap-2` rhythm; `footer` stays pinned below the scroll.
 */
export function AppSidebar({ children, footer }: { children: ReactNode; footer?: ReactNode }) {
  return (
    <Sidebar
      collapsible="offcanvas"
      // Anchored to `Main`, not the viewport, so content above the row never sits under it.
      className="absolute h-full"
    >
      <SidebarContent>
        <SidebarGroup className="gap-2">{children}</SidebarGroup>
      </SidebarContent>
      {footer ? <SidebarFooter className="gap-0 p-0">{footer}</SidebarFooter> : null}
      <SidebarRail />
    </Sidebar>
  );
}

/**
 * The map side of the page; fills whatever the sidebar leaves. A strip across its top anchors
 * the toast region (`setToastAnchor`), above the map overlay and below modal layers.
 */
export function MapContent({ children }: { children: ReactNode }) {
  return (
    <SidebarInset className="min-h-0 bg-muted">
      {children}
      <div
        ref={setToastAnchor}
        data-slot="toast-anchor"
        className="pointer-events-none absolute inset-x-0 top-0 z-30"
      />
    </SidebarInset>
  );
}
