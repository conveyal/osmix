import { openNodePath, Tasks, useTasks } from "@osmix/app-core";
import { Button, ElapsedTimer, IconButton, Spinner, StatusDot } from "@osmix/ui";
import { useSetAtom } from "jotai";
import { ListTreeIcon, XIcon } from "lucide-react";

import { activitySheetOpenAtom } from "../state/activity.ts";

/**
 * The nav's centre: the running task, its current step and a live timer (with Cancel when the
 * task allows it), or an "Activity" button with the last outcome when idle. Either opens the
 * Activity sheet. Below `md` the running form shrinks to the spinner and timer, and the idle
 * form to its status dot.
 */
export function TaskIndicator() {
  const { current, entries, lastFinished } = useTasks();
  const setSheetOpen = useSetAtom(activitySheetOpenAtom);

  if (current) {
    const path = openNodePath(current);
    const step = path.length > 1 ? path.at(-1) : undefined;
    const cancelling = current.status === "cancelling";
    const label = `${current.title}${step ? ` › ${step.title}` : ""}`;
    return (
      <div className="flex min-w-0 items-center gap-1">
        <Button
          variant="ghost"
          size="sm"
          className="min-w-0"
          title={label}
          aria-label={`${label}. ${cancelling ? "Cancelling" : "Running"}. Open activity`}
          onClick={() => setSheetOpen(true)}
        >
          <Spinner aria-hidden="true" role="presentation" />
          <span className="hidden min-w-0 truncate md:inline">
            {cancelling ? `Cancelling ${current.title}…` : label}
          </span>
          <ElapsedTimer
            key={current.id}
            startedAt={current.startedAt}
            className="text-muted-foreground"
          />
        </Button>
        {current.cancellable ? (
          <IconButton
            label={cancelling ? "Cancelling…" : `Cancel ${current.title}`}
            icon={<XIcon aria-hidden="true" />}
            disabled={cancelling}
            onClick={() => Tasks.cancel(current.id)}
          />
        ) : null}
        <span className="sr-only" role="status" aria-live="polite">
          {step ? `${current.title}: ${step.title}` : current.title}
        </span>
      </div>
    );
  }

  const lastEntry = entries.at(-1);
  const lastWasError =
    (lastEntry?.kind === "message" && lastEntry.level === "error") ||
    (lastEntry?.kind !== "message" && lastFinished?.status === "error");
  return (
    <Button variant="ghost" size="sm" aria-label="Activity" onClick={() => setSheetOpen(true)}>
      {lastEntry ? (
        <StatusDot status={lastWasError ? "error" : "ok"} />
      ) : (
        <ListTreeIcon aria-hidden="true" />
      )}
      <span className="hidden md:inline">Activity</span>
      <span className="sr-only" role="status" aria-live="polite">
        {lastFinished?.summary ?? ""}
      </span>
    </Button>
  );
}
