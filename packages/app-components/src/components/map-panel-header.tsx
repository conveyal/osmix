import { ScrollArea, SectionTitle } from "@osmix/ui";
import type { ReactNode } from "react";

/**
 * The header row of every floating map panel (`CustomControl`): an optional icon, the
 * section title, an optional muted detail (a file name, a count), and trailing `IconButton`
 * actions. Follow it with `MapPanelBody`.
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
 * The scrolling body of a floating map panel, below `MapPanelHeader`: it fills the rest of the
 * panel (capped at half the viewport) so the header stays in view while the content scrolls.
 */
export function MapPanelBody({ children }: { children: ReactNode }) {
  return <ScrollArea className="flex-1">{children}</ScrollArea>;
}
