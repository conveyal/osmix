import type { ReactNode } from "react";

import { cn } from "../lib/utils.ts";

/**
 * A numbered workflow step: the card that opens each stage of a multi-step flow (Merge's
 * wizard, Extract's form). Numbers render as "1." in mono; omit `number` for an unnumbered
 * step such as Merge's automatic workflow. Put `CardContent` and other content in `children`.
 */
export function Step({
  className,
  number,
  title,
  action,
  children,
}: {
  className?: string;
  number?: number;
  title: ReactNode;
  action?: ReactNode;
  children?: ReactNode;
}) {
  return (
    <section
      data-slot="step"
      className={cn("flex flex-col rounded-md border bg-card text-card-foreground", className)}
    >
      <div data-slot="step-header" className="flex min-h-9 items-center gap-2 border-b px-2 py-1.5">
        <h2 className="flex min-w-0 flex-1 items-baseline gap-2 text-sm font-semibold">
          {number !== undefined ? (
            <span data-slot="step-number" className="font-mono font-bold text-brand">
              {number}.
            </span>
          ) : null}
          <span data-slot="step-title">{title}</span>
        </h2>
        {action ? <div className="flex shrink-0 items-center gap-1">{action}</div> : null}
      </div>
      {children}
    </section>
  );
}
