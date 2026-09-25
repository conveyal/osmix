import { isTaskNode, isTaskOpen, Tasks, type TasksSnapshot } from "@osmix/app-core";
import { formatDuration, showToast } from "@osmix/ui";
import { useSetAtom } from "jotai";
import { useEffect } from "react";

import { activitySheetOpenAtom } from "../state/activity.ts";

/** Successful tasks shorter than this finish without a toast: the screen already changed. */
export const QUIET_TASK_MS = 1_500;

type ToastRequest = Parameters<typeof showToast>[0] & { viewDetails?: boolean };

/**
 * The toasts owed for the change from `prev` to `next`: one per top-level task that finished,
 * and one per new top-level error message.
 */
export function taskToasts(prev: TasksSnapshot, next: TasksSnapshot): ToastRequest[] {
  const wasOpen = new Set(
    prev.entries.filter((e) => isTaskNode(e) && isTaskOpen(e)).map((e) => e.id),
  );
  const seen = new Set(prev.entries.map((e) => e.id));
  const toasts: ToastRequest[] = [];
  for (const entry of next.entries) {
    if (entry.kind === "message") {
      if (!seen.has(entry.id) && entry.level === "error") {
        toasts.push({ variant: "error", title: entry.message, viewDetails: true });
      }
      continue;
    }
    if (isTaskOpen(entry) || !(wasOpen.has(entry.id) || !seen.has(entry.id))) continue;
    const durationMs = (entry.endedAt ?? entry.startedAt) - entry.startedAt;
    if (entry.status === "done") {
      if (durationMs < QUIET_TASK_MS) continue;
      toasts.push({
        variant: "success",
        title: entry.summary ?? entry.title,
        description: `${entry.title} took ${formatDuration(durationMs)}`,
      });
    } else if (entry.status === "cancelled") {
      toasts.push({ variant: "info", title: entry.summary ?? `${entry.title} cancelled` });
    } else if (entry.status === "error") {
      toasts.push({
        variant: "error",
        title: `${entry.title} failed`,
        ...(entry.summary ? { description: entry.summary } : {}),
        viewDetails: true,
      });
    }
  }
  return toasts;
}

/** Toast top-level task outcomes. Error toasts link to the Activity sheet. */
export function TaskToasts() {
  const setSheetOpen = useSetAtom(activitySheetOpenAtom);
  useEffect(() => {
    let prev = Tasks.getSnapshot();
    return Tasks.subscribe(() => {
      const next = Tasks.getSnapshot();
      for (const { viewDetails, ...toast } of taskToasts(prev, next)) {
        showToast(
          viewDetails
            ? { ...toast, action: { label: "View details", onClick: () => setSheetOpen(true) } }
            : toast,
        );
      }
      prev = next;
    });
  }, [setSheetOpen]);
  return null;
}
