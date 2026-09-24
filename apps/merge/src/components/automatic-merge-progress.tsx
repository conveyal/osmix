import { useLog } from "@osmix/app-core";
import { Card, CardAction, CardHeader, cn, Spinner } from "@osmix/ui";
import { CheckIcon, CircleIcon } from "lucide-react";
import { useEffect, useState } from "react";

export interface AutomaticMergeStep {
  id: AutomaticMergeStepId;
  label: string;
}

export type AutomaticMergeStepId =
  | "apply-verified-merge"
  | "create-intersections"
  | "discover-imported-data"
  | "generate-verified-merge"
  | "merge-exact"
  | "refresh-result";

export const EXACT_AUTOMATIC_MERGE_STEPS = [
  {
    id: "merge-exact",
    label: "Merge, reconcile, and create intersections",
  },
  {
    id: "refresh-result",
    label: "Refresh merged dataset",
  },
] as const satisfies readonly AutomaticMergeStep[];

export const CONFLATION_AUTOMATIC_MERGE_STEPS = [
  {
    id: "discover-imported-data",
    label: "Discover imported-data matches",
  },
  {
    id: "generate-verified-merge",
    label: "Generate and validate merge changes",
  },
  {
    id: "apply-verified-merge",
    label: "Apply verified merge changes",
  },
  {
    id: "create-intersections",
    label: "Create and apply safe intersections",
  },
  {
    id: "refresh-result",
    label: "Refresh merged dataset",
  },
] as const satisfies readonly AutomaticMergeStep[];

export interface AutomaticMergeProgressState {
  currentStepId: AutomaticMergeStepId;
  steps: readonly AutomaticMergeStep[];
}

function formatElapsed(ms: number) {
  const totalSeconds = Math.floor(ms / 1_000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}:${String(seconds).padStart(2, "0")}`;
}

export function AutomaticMergeProgress({
  currentStepId,
  elapsedMs = 0,
  latestMessage,
  steps,
}: AutomaticMergeProgressState & {
  elapsedMs?: number;
  latestMessage?: string;
}) {
  const currentIndex = steps.findIndex((step) => step.id === currentStepId);
  if (currentIndex === -1) {
    throw Error(`Unknown automatic merge step: ${currentStepId}`);
  }

  const completedCount = currentIndex;
  const currentStep = steps[currentIndex];

  return (
    <Card>
      <CardHeader>
        Merge progress
        <CardAction className="tabular-nums" data-slot="automatic-merge-elapsed">
          {formatElapsed(Math.max(0, elapsedMs))}
        </CardAction>
      </CardHeader>
      <p className="sr-only" role="status" aria-live="polite">
        {currentStep.label} is running. {completedCount} of {steps.length} steps completed.
      </p>
      <ol aria-label="Automatic merge progress" className="divide-y">
        {steps.map((step, index) => {
          const status =
            index < currentIndex ? "completed" : index === currentIndex ? "running" : "remaining";

          return (
            <li
              aria-current={status === "running" ? "step" : undefined}
              className={cn(
                "grid grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-2 px-2 py-2",
                status === "remaining" && "text-muted-foreground",
              )}
              data-status={status}
              key={step.id}
            >
              <span className="flex size-3.5 items-center justify-center self-start">
                {status === "completed" ? (
                  <CheckIcon aria-hidden="true" className="size-3.5 text-success" />
                ) : status === "running" ? (
                  <Spinner aria-hidden="true" className="size-3.5" role="presentation" />
                ) : (
                  <CircleIcon aria-hidden="true" className="size-3.5" />
                )}
              </span>
              <span className={cn("min-w-0", status === "running" && "font-semibold")}>
                {step.label}
              </span>
              <span className="text-muted-foreground">
                {status === "completed"
                  ? "Completed"
                  : status === "running"
                    ? "Running"
                    : "Remaining"}
              </span>
              {status === "running" && latestMessage ? (
                <p
                  className="col-span-2 col-start-2 truncate text-muted-foreground"
                  data-slot="automatic-merge-latest-message"
                  title={latestMessage}
                >
                  {latestMessage}
                </p>
              ) : null}
            </li>
          );
        })}
      </ol>
    </Card>
  );
}

export function LiveAutomaticMergeProgress(props: AutomaticMergeProgressState) {
  const { activeTasks, log, taskStartedAt } = useLog();
  const [now, setNow] = useState(() => Date.now());
  const [clockStartedAt, setClockStartedAt] = useState(taskStartedAt);
  if (clockStartedAt !== taskStartedAt) {
    // Start the clock at zero; the interval below advances it once a second.
    setClockStartedAt(taskStartedAt);
    setNow(taskStartedAt ?? now);
  }

  useEffect(() => {
    if (taskStartedAt == null) return;
    const interval = setInterval(() => setNow(Date.now()), 1_000);
    return () => clearInterval(interval);
  }, [taskStartedAt]);

  const latestMessage = activeTasks > 0 ? log[log.length - 1]?.message : undefined;
  const elapsedMs = taskStartedAt == null ? 0 : Math.max(0, now - taskStartedAt);

  return <AutomaticMergeProgress {...props} elapsedMs={elapsedMs} latestMessage={latestMessage} />;
}
