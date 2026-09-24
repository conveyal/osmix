import type { ReactNode } from "react";

import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarInset,
  SidebarRail,
} from "./ui/sidebar.tsx";

/** The row under the nav: `AppSidebar` then `MapContent`. */
export function Main({ children }: { children: ReactNode }) {
  return (
    <div data-slot="main" className="flex min-h-0 w-full flex-1 flex-row">
      {children}
    </div>
  );
}

/**
 * The app sidebar: shadcn's `Sidebar`, below the nav, collapsing offcanvas (nav trigger, the
 * edge rail, or Cmd/Ctrl+B; a sheet on mobile). Children scroll in one `ScrollArea` with the
 * inset gutter and `gap-2` rhythm; `footer` (the activity log) stays pinned.
 */
export function AppSidebar({ children, footer }: { children: ReactNode; footer?: ReactNode }) {
  return (
    <Sidebar
      collapsible="offcanvas"
      className="top-(--header-height) h-[calc(100svh-var(--header-height))]"
    >
      <SidebarContent>
        <SidebarGroup className="gap-2">{children}</SidebarGroup>
      </SidebarContent>
      {footer ? <SidebarFooter className="gap-0 p-0">{footer}</SidebarFooter> : null}
      <SidebarRail />
    </Sidebar>
  );
}

/** The map side of the page; fills whatever the sidebar leaves. */
export function MapContent({ children }: { children: ReactNode }) {
  return <SidebarInset className="min-h-0 bg-muted">{children}</SidebarInset>;
}
