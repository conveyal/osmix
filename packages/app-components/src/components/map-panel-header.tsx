import { ScrollArea, SectionTitle } from "@osmix/ui";
import type { ReactNode } from "react";

/**
 * The header row of a `MapPanel`: an optional icon, the section title, an optional muted
 * detail (a file name, a dataset label), and trailing `IconButton` actions flush with the
 * panel's edge. Follow it with `MapPanelBody`.
 */
export function MapPanelHeader({
  icon,
  title,
  detail,
  actions,
}: {
  icon?: ReactNode;
  title: ReactNode;
  detail?: ReactNode;
  actions?: ReactNode;
}) {
  return (
    <div
      data-slot="map-panel-header"
      className="flex min-h-8 shrink-0 items-center justify-between gap-2 border-b pl-inset [&_svg:not([class*='size-'])]:size-3.5"
    >
      <div className="flex min-w-0 items-center gap-2">
        {icon ? <span className="flex shrink-0 text-muted-foreground">{icon}</span> : null}
        <SectionTitle className="shrink-0">{title}</SectionTitle>
        {detail ? <span className="truncate font-mono text-muted-foreground">{detail}</span> : null}
      </div>
      {actions ? <div className="flex shrink-0 items-center">{actions}</div> : null}
    </div>
  );
}

/**
 * The scrolling body of a `MapPanel`, below `MapPanelHeader`. It takes the rest of the panel,
 * whose height the overlay region bounds, so the header stays in view while the content
 * scrolls.
 */
export function MapPanelBody({ children }: { children: ReactNode }) {
  return <ScrollArea className="min-h-0 flex-1">{children}</ScrollArea>;
}
