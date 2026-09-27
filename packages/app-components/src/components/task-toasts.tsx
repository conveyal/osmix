import {
  isTaskNode,
  isTaskOpen,
  openNodePath,
  type TaskNode,
  Tasks,
  type TasksSnapshot,
  useTasks,
} from "@osmix/app-core";
import { Button, closeToast, ElapsedTimer, formatDuration, showToast } from "@osmix/ui";
import { useSetAtom, useStore } from "jotai";
import { useEffect } from "react";

import {
  acknowledgedErrorIdAtom,
  activitySheetOpenAtom,
  latestErrorId,
} from "../state/activity.ts";

/** Successful tasks shorter than this finish without a toast: the screen already changed. */
export const QUIET_TASK_MS = 1_500;

/** A task's progress toast appears only once it has run this long, so quick work never flashes. */
export const PROGRESS_TOAST_DELAY_MS = 400;

/** An outcome toast. `viewDetails` adds a "View details" action that opens the Activity sheet. */
export interface TaskToastRequest {
  variant: "success" | "info" | "error";
  title: string;
  description?: string;
  viewDetails?: boolean;
}

/**
 * One change the toasts must follow, from `taskToastEvents(prev, next)`:
 * - `started`: a top-level task opened; its progress toast is due after the delay.
 * - `finished`: it ended; `toast` replaces its progress toast, or `null` closes it quietly.
 * - `message`: a new top-level error message; `id` is its entry id.
 */
export type TaskToastEvent =
  | { kind: "started"; taskId: string }
  | { kind: "finished"; taskId: string; toast: TaskToastRequest | null }
  | { kind: "message"; id: string; toast: TaskToastRequest };

/** The toast id for a task: its progress toast and outcome toast share it. */
export function taskToastId(taskId: string): string {
  return `task:${taskId}`;
}

/** The outcome toast for a finished top-level task, or `null` for a quick success. */
export function taskOutcomeToast(task: TaskNode): TaskToastRequest | null {
  const durationMs = (task.endedAt ?? task.startedAt) - task.startedAt;
  switch (task.status) {
    case "done":
      if (durationMs < QUIET_TASK_MS) return null;
      return {
        variant: "success",
        title: task.summary ?? task.title,
        description: `${task.title} took ${formatDuration(durationMs)}`,
      };
    case "cancelled":
      return { variant: "info", title: task.summary ?? `${task.title} cancelled` };
    case "error":
      return {
        variant: "error",
        title: `${task.title} failed`,
        ...(task.summary ? { description: task.summary } : {}),
        viewDetails: true,
      };
    default:
      return null;
  }
}

/**
 * The toast events for the change from `prev` to `next`: top-level tasks that started or
 * finished, and new top-level error messages. Steps never toast.
 */
export function taskToastEvents(prev: TasksSnapshot, next: TasksSnapshot): TaskToastEvent[] {
  const wasOpen = new Set(
    prev.entries.filter((e) => isTaskNode(e) && isTaskOpen(e)).map((e) => e.id),
  );
  const seen = new Set(prev.entries.map((e) => e.id));
  const events: TaskToastEvent[] = [];
  for (const entry of next.entries) {
    if (entry.kind === "message") {
      if (!seen.has(entry.id) && entry.level === "error") {
        events.push({
          kind: "message",
          id: entry.id,
          toast: { variant: "error", title: entry.message, viewDetails: true },
        });
      }
      continue;
    }
    const isNew = !seen.has(entry.id);
    if (isTaskOpen(entry)) {
      if (isNew) events.push({ kind: "started", taskId: entry.id });
      continue;
    }
    if (isNew || wasOpen.has(entry.id)) {
      events.push({ kind: "finished", taskId: entry.id, toast: taskOutcomeToast(entry) });
    }
  }
  return events;
}

/**
 * Toast every top-level task: a progress toast (title, current step, timer, Cancel and Details)
 * once it has run `PROGRESS_TOAST_DELAY_MS`, replaced in place by its outcome when it ends.
 * Quick successes close without an outcome; failures and cancellations always get one. New
 * top-level error messages toast too. Dismissing the newest error's toast acknowledges it.
 * A quick success still reaches assistive tech: its summary goes to a polite live region.
 */
export function TaskToasts() {
  const store = useStore();
  const { lastFinished } = useTasks();
  const quietSummary =
    lastFinished && taskOutcomeToast(lastFinished) === null ? (lastFinished.summary ?? "") : "";
  useEffect(() => {
    const timers = new Map<string, ReturnType<typeof setTimeout>>();
    const clearTimer = (taskId: string) => {
      clearTimeout(timers.get(taskId));
      timers.delete(taskId);
    };
    const show = (id: string, entryId: string, { viewDetails, ...toast }: TaskToastRequest) => {
      showToast({
        ...toast,
        id,
        ...(viewDetails
          ? {
              action: {
                label: "View details",
                onClick: () => store.set(activitySheetOpenAtom, true),
              },
              onClose: () => {
                if (latestErrorId(Tasks.getSnapshot().entries) === entryId) {
                  store.set(acknowledgedErrorIdAtom, entryId);
                }
              },
            }
          : {}),
      });
    };

    let prev = Tasks.getSnapshot();
    const unsubscribe = Tasks.subscribe(() => {
      const next = Tasks.getSnapshot();
      for (const event of taskToastEvents(prev, next)) {
        if (event.kind === "message") {
          show(event.id, event.id, event.toast);
        } else if (event.kind === "started") {
          const { taskId } = event;
          timers.set(
            taskId,
            setTimeout(() => {
              timers.delete(taskId);
              showToast({
                id: taskToastId(taskId),
                variant: "progress",
                title: <RunningTaskTitle taskId={taskId} />,
                actions: <RunningTaskActions taskId={taskId} />,
              });
            }, PROGRESS_TOAST_DELAY_MS),
          );
        } else {
          clearTimer(event.taskId);
          const id = taskToastId(event.taskId);
          if (event.toast) show(id, event.taskId, event.toast);
          else closeToast(id);
        }
      }
      prev = next;
    });
    return () => {
      unsubscribe();
      for (const timer of timers.values()) clearTimeout(timer);
    };
  }, [store]);
  return (
    <span className="sr-only" role="status" aria-live="polite">
      {quietSummary}
    </span>
  );
}

/** The running top-level task with this id, or `null` once it has ended. */
function useRunningTask(taskId: string): TaskNode | null {
  const { current } = useTasks();
  return current?.id === taskId ? current : null;
}

/**
 * "Task › step" and a live timer. The timer is hidden from assistive tech so the toast region
 * announces step changes, not every tick.
 */
function RunningTaskTitle({ taskId }: { taskId: string }) {
  const task = useRunningTask(taskId);
  if (!task) return null;
  const path = openNodePath(task);
  const step = path.length > 1 ? path.at(-1) : undefined;
  const label =
    task.status === "cancelling"
      ? `Cancelling ${task.title}…`
      : `${task.title}${step ? ` › ${step.title}` : ""}`;
  return (
    <span className="flex min-w-0 items-baseline gap-2">
      <span className="min-w-0 flex-1 truncate" title={label}>
        {label}
      </span>
      <span aria-hidden="true">
        <ElapsedTimer startedAt={task.startedAt} className="font-normal text-muted-foreground" />
      </span>
    </span>
  );
}

/** Cancel (when the task allows it) and Details, which opens the Activity sheet. */
function RunningTaskActions({ taskId }: { taskId: string }) {
  const task = useRunningTask(taskId);
  const setSheetOpen = useSetAtom(activitySheetOpenAtom);
  if (!task) return null;
  const cancelling = task.status === "cancelling";
  return (
    <>
      {task.cancellable ? (
        <Button
          variant="link"
          size="xs"
          className="px-0"
          disabled={cancelling}
          onClick={() => Tasks.cancel(task.id)}
        >
          {cancelling ? "Cancelling…" : "Cancel"}
        </Button>
      ) : null}
      <Button variant="link" size="xs" className="px-0" onClick={() => setSheetOpen(true)}>
        Details
      </Button>
    </>
  );
}
