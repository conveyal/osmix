import type { ReactNode } from "react";

import { cn } from "../lib/utils";
import { Spinner } from "./ui/spinner";

/**
 * The single section-title style: bold, uppercase, tracking-wide at the inherited
 * xs size. Never hand-write `font-bold uppercase` at call sites — use this (or
 * CardHeader/DetailsSummary, which apply the same role).
 */
export function SectionTitle({ className, children }: { className?: string; children: ReactNode }) {
  return (
    <div
      data-slot="section-title"
      className={cn("flex items-center gap-1 font-bold uppercase tracking-wide", className)}
    >
      {children}
    </div>
  );
}

export function LoadingState({
  className,
  children = "Loading...",
}: {
  className?: string;
  children?: ReactNode;
}) {
  return (
    <div
      data-slot="loading-state"
      className={cn("flex items-center gap-2 p-2 text-muted-foreground", className)}
    >
      <Spinner />
      {children}
    </div>
  );
}

export function EmptyState({ className, children }: { className?: string; children: ReactNode }) {
  return (
    <div data-slot="empty-state" className={cn("p-2 text-muted-foreground", className)}>
      {children}
    </div>
  );
}
