import {
  CheckIcon,
  ChevronRightIcon,
  CircleAlertIcon,
  CircleMinusIcon,
  CopyIcon,
  TriangleAlertIcon,
} from "lucide-react";
import type { ReactNode } from "react";

import { cn } from "../lib/utils.ts";
import { IconButton } from "./icon-button.tsx";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "./ui/collapsible.tsx";
import { Spinner } from "./ui/spinner.tsx";

export type ActivityStatus = "running" | "cancelling" | "done" | "error" | "cancelled";
export type ActivityLevel = "info" | "warn" | "error";

/** One icon per task state: a spinner while open, then check, error, or cancelled. */
export function ActivityStatusIcon({ status }: { status: ActivityStatus }) {
  switch (status) {
    case "running":
    case "cancelling":
      return <Spinner aria-hidden="true" role="presentation" className="size-3.5" />;
    case "done":
      return <CheckIcon aria-hidden="true" className="size-3.5 text-success" />;
    case "error":
      return <CircleAlertIcon aria-hidden="true" className="size-3.5 text-destructive" />;
    case "cancelled":
      return <CircleMinusIcon aria-hidden="true" className="size-3.5 text-muted-foreground" />;
  }
}

const STATUS_LABELS: Record<ActivityStatus, string> = {
  running: "Running",
  cancelling: "Cancelling",
  done: "Done",
  error: "Failed",
  cancelled: "Cancelled",
};

/**
 * Tree geometry, in one place so rows line up across levels. A row is a 12px chevron column, a
 * 14px icon column, the title and `meta`, with 4px gaps, so the title starts at 34px. Children
 * start 18px in, under the parent's icon, with the guide line dropping from the parent's chevron;
 * a child's own title then starts under the parent's title.
 */
const ITEM_GRID = "grid w-full grid-cols-[0.75rem_0.875rem_minmax(0,1fr)_auto] gap-x-1";
const CHILDREN = "ml-1.5 flex flex-col border-l pl-[11px]";
/** Offset of message text and error blocks from a row's start: one chevron column plus a gap. */
const TEXT_INSET = "ml-4";

/**
 * A task or step in the activity tree: a status icon, title and right-aligned `meta` (a timer or
 * duration), then `actions` (such as Cancel) outside the row's toggle. With `children` it
 * collapses, and nested rows hang off a guide line.
 */
export function ActivityItem({
  actions,
  children,
  defaultOpen = false,
  detail,
  meta,
  status,
  title,
  titleAttribute,
  topLevel = false,
}: {
  /** Controls after the row, outside its collapse toggle. */
  actions?: ReactNode;
  children?: ReactNode;
  defaultOpen?: boolean;
  /** A live progress line shown under the title while running. */
  detail?: string | undefined;
  meta?: ReactNode;
  status: ActivityStatus;
  title: ReactNode;
  titleAttribute?: string | undefined;
  topLevel?: boolean;
}) {
  const header = (
    <>
      <span className="flex size-3.5 items-center justify-center">
        <ActivityStatusIcon status={status} />
      </span>
      <span className={cn("min-w-0 truncate text-left", topLevel && "font-medium")}>
        {title}
        <span className="sr-only">, {STATUS_LABELS[status]}</span>
      </span>
      <span className="text-muted-foreground">{meta}</span>
      {detail ? (
        <span className="col-start-3 col-end-5 truncate text-left font-mono text-muted-foreground">
          {detail}
        </span>
      ) : null}
    </>
  );
  const grid = cn(ITEM_GRID, "items-center py-1");
  if (!children) {
    const row = (
      <div
        data-slot="activity-item"
        data-status={status}
        className={cn(grid, actions && "min-w-0 flex-1")}
        title={titleAttribute}
      >
        <span />
        {header}
      </div>
    );
    return actions ? (
      <div className="flex items-center gap-1">
        {row}
        {actions}
      </div>
    ) : (
      row
    );
  }
  return (
    <Collapsible data-slot="activity-item" data-status={status} defaultOpen={defaultOpen}>
      <div className="flex items-center gap-1">
        <CollapsibleTrigger
          className={cn(
            grid,
            "group min-w-0 flex-1 cursor-pointer rounded-sm focus-ring hover:bg-accent",
          )}
          title={titleAttribute}
        >
          <ChevronRightIcon
            aria-hidden="true"
            className="size-3 text-muted-foreground transition-transform group-data-panel-open:rotate-90"
          />
          {header}
        </CollapsibleTrigger>
        {actions}
      </div>
      <CollapsibleContent>
        <div className={CHILDREN}>{children}</div>
      </CollapsibleContent>
    </Collapsible>
  );
}

/**
 * A plain message under a task: its level icon in the chevron column (under the parent's status
 * icon), text aligned with the parent's title, and `meta` (e.g. "+2.31s").
 */
export function ActivityMessage({
  level,
  message,
  meta,
  titleAttribute,
}: {
  level: ActivityLevel;
  message: string;
  meta?: ReactNode;
  titleAttribute?: string;
}) {
  return (
    <div
      data-slot="activity-message"
      data-level={level}
      title={titleAttribute}
      className={cn(
        "grid grid-cols-[0.75rem_minmax(0,1fr)_auto] items-start gap-x-1 py-0.5",
        level === "info" && "text-muted-foreground",
        level === "warn" && "text-warning",
        level === "error" && "text-destructive",
      )}
    >
      <span className="flex h-lh items-center justify-center">
        {level === "warn" ? (
          <TriangleAlertIcon aria-hidden="true" className="size-3" />
        ) : level === "error" ? (
          <CircleAlertIcon aria-hidden="true" className="size-3" />
        ) : (
          <span aria-hidden="true" className="size-1 rounded-full bg-current" />
        )}
      </span>
      <span className="min-w-0 wrap-break-word">{message}</span>
      <span className="font-mono text-muted-foreground tabular-nums">{meta}</span>
    </div>
  );
}

/** The expanded error for a failed task or step, with its stack and a copy button. */
export function ActivityError({ message, stack }: { message: string; stack?: string | undefined }) {
  const text =
    stack && stack.includes(message) ? stack : [message, stack].filter(Boolean).join("\n");
  return (
    <div
      data-slot="activity-error"
      className={cn(
        TEXT_INSET,
        "my-1 flex gap-1 rounded-sm border border-destructive/40 bg-destructive/5 p-2",
      )}
    >
      <pre className="min-w-0 flex-1 overflow-x-auto font-mono wrap-break-word whitespace-pre-wrap text-destructive">
        {text}
      </pre>
      <IconButton
        label="Copy error"
        size="icon-xs"
        icon={<CopyIcon aria-hidden="true" />}
        onClick={() => void navigator.clipboard.writeText(text)}
      />
    </div>
  );
}
