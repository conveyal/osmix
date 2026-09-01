import type * as React from "react";

import { cn } from "../lib/utils";

/**
 * Full-width workflow actions for the narrow Merge sidebar.
 *
 * Global buttons stay single-line for compact toolbars. Step actions instead
 * stack and wrap so long, decision-oriented labels remain readable without
 * forcing the sidebar wider.
 */
export function StepActions({
  "aria-label": ariaLabel = "Step actions",
  className,
  ...props
}: React.ComponentProps<"div">) {
  return (
    <div
      aria-label={ariaLabel}
      data-slot="step-actions"
      role="group"
      className={cn(
        "flex w-full min-w-0 flex-col gap-2",
        "[&>[data-slot=button]]:h-auto [&>[data-slot=button]]:min-h-9",
        "[&>[data-slot=button]]:w-full [&>[data-slot=button]]:min-w-0",
        "[&>[data-slot=button]]:shrink [&>[data-slot=button]]:whitespace-normal",
        "[&>[data-slot=button]]:py-2 [&>[data-slot=button]]:leading-tight",
        className,
      )}
      {...props}
    />
  );
}
