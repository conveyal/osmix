import type { ReactNode } from "react";

import { cn } from "../lib/utils.ts";
import { Spinner } from "./ui/spinner.tsx";

/**
 * The single section-title style: bold, uppercase, tracking-wide at the inherited
 * xs size. Never hand-write `font-bold uppercase` at call sites — use this (or
 * SidebarSection/DetailsSummary, which apply the same role).
 */
export function SectionTitle({ className, children }: { className?: string; children: ReactNode }) {
  return (
    <div
      data-slot="section-title"
      className={cn(
        "flex items-center gap-1 font-mono font-bold tracking-wider uppercase",
        className,
      )}
    >
      {children}
    </div>
  );
}

export function LoadingState({
  className,
  children = "Loading…",
}: {
  className?: string;
  children?: ReactNode;
}) {
  return (
    <div
      data-slot="loading-state"
      className={cn("flex items-center gap-2 p-inset text-muted-foreground", className)}
    >
      <Spinner />
      {children}
    </div>
  );
}

export function EmptyState({ className, children }: { className?: string; children: ReactNode }) {
  return (
    <div data-slot="empty-state" className={cn("p-inset text-muted-foreground", className)}>
      {children}
    </div>
  );
}
