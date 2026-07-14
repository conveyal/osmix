import type * as React from "react";

import { cn } from "../lib/utils";

const STATUS_COLORS = {
  ok: "bg-success",
  error: "bg-destructive",
  warn: "bg-warning",
} as const;

export type StatusDotStatus = keyof typeof STATUS_COLORS;

export function StatusDot({
  className,
  status,
  ...props
}: React.ComponentProps<"div"> & {
  status: StatusDotStatus;
}) {
  return (
    <div
      data-slot="status-dot"
      className={cn("size-2 shrink-0 rounded-full", STATUS_COLORS[status], className)}
      {...props}
    />
  );
}
