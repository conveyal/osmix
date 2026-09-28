import type { ReactNode } from "react";
import { useId } from "react";

import { cn } from "../lib/utils.ts";

/**
 * One section of the app sidebar: a title row, then its content, with one divider below. It
 * spans the sidebar edge to edge and is flat (no box, no background): the sidebar is the
 * surface. `number` renders a workflow step's "1." before the title (see `Step`).
 *
 * The body is padded by the inset with a `gap-2` rhythm. `flush` drops that padding so tables,
 * `Details` and divided lists reach the sidebar edges; flush children then pad themselves with
 * `px-inset` (or `p-inset`) as they did inside a flush card.
 *
 * The section is a labelled region named by its title; pass `aria-label` for another name.
 */
export function SidebarSection({
  "aria-label": ariaLabel,
  action,
  children,
  className,
  flush = false,
  number,
  title,
}: {
  "aria-label"?: string;
  action?: ReactNode;
  children?: ReactNode;
  className?: string;
  flush?: boolean;
  number?: number;
  title: ReactNode;
}) {
  const titleId = useId();
  return (
    <section
      data-slot="sidebar-section"
      aria-label={ariaLabel}
      aria-labelledby={ariaLabel ? undefined : titleId}
      className={cn("flex min-w-0 flex-col border-b", className)}
    >
      <div
        data-slot="sidebar-section-header"
        className="flex min-h-8 items-center gap-2 px-inset pt-inset pb-2"
      >
        <h2
          id={titleId}
          className="flex min-w-0 flex-1 items-baseline gap-2 font-mono text-sm font-bold tracking-wider uppercase"
        >
          {number !== undefined ? (
            <span data-slot="sidebar-section-number" className="text-brand">
              {number}.
            </span>
          ) : null}
          <span data-slot="sidebar-section-title" className="min-w-0">
            {title}
          </span>
        </h2>
        {action ? <div className="-my-1 flex shrink-0 items-center gap-1">{action}</div> : null}
      </div>
      {children ? (
        <div
          data-slot="sidebar-section-content"
          className={cn("flex min-w-0 flex-col", flush ? "" : "gap-2 px-inset pb-inset")}
        >
          {children}
        </div>
      ) : null}
    </section>
  );
}
