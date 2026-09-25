import { isTaskNode, isTaskOpen, type TaskNode, useTasks } from "@osmix/app-core";
import {
  Card,
  CardAction,
  CardHeader,
  cn,
  ElapsedTimer,
  formatElapsedClock,
  Spinner,
} from "@osmix/ui";
import { CheckIcon, CircleIcon } from "lucide-react";

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

/** When a stage started and, once it is done, ended (epoch milliseconds). */
export interface AutomaticMergeStepTiming {
  startedAt: number;
  endedAt?: number | undefined;
}

export function AutomaticMergeProgress({
  currentStepId,
  elapsedMs = 0,
  latestMessage,
  startedAt,
  stepTimings,
  steps,
}: AutomaticMergeProgressState & {
  /** A fixed elapsed time. Ignored when `startedAt` is set. */
  elapsedMs?: number;
  latestMessage?: string | undefined;
  /** The run's start: shows a live timer instead of `elapsedMs`. */
  startedAt?: number | undefined;
  /** Per-stage timing: each finished stage shows its duration, the running one a live timer. */
  stepTimings?: Partial<Record<AutomaticMergeStepId, AutomaticMergeStepTiming>>;
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
          {startedAt === undefined ? (
            formatElapsedClock(elapsedMs)
          ) : (
            <ElapsedTimer startedAt={startedAt} />
          )}
        </CardAction>
      </CardHeader>
      <p className="sr-only" role="status" aria-live="polite">
        {currentStep.label} is running. {completedCount} of {steps.length} steps completed.
      </p>
      <ol aria-label="Automatic merge progress" className="divide-y">
        {steps.map((step, index) => {
          const status =
            index < currentIndex ? "completed" : index === currentIndex ? "running" : "remaining";
          const timing = stepTimings?.[step.id];

          return (
            <li
              aria-current={status === "running" ? "step" : undefined}
              className={cn(
                "grid grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-2 px-inset py-2",
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
                {status === "remaining" ? (
                  "Remaining"
                ) : timing ? (
                  <ElapsedTimer
                    startedAt={timing.startedAt}
                    endedAt={
                      status === "completed" ? (timing.endedAt ?? timing.startedAt) : undefined
                    }
                  />
                ) : status === "completed" ? (
                  "Completed"
                ) : (
                  "Running"
                )}
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

export interface LiveAutomaticMergeProgressProps {
  /** The "Run automatic merge" task whose steps are the stages. */
  taskId: string;
  steps: readonly AutomaticMergeStep[];
}

/** The latest line under a running node: its live detail, else its newest message. */
function latestLine(node: TaskNode): string | undefined {
  if (node.detail) return node.detail;
  return node.children.findLast((child) => child.kind === "message")?.message;
}

/**
 * `AutomaticMergeProgress` driven by the run's task: each stage is a step titled with the
 * stage's label, so stage state, per-stage timing and the latest worker line come from the tree.
 */
export function LiveAutomaticMergeProgress({ taskId, steps }: LiveAutomaticMergeProgressProps) {
  const { entries } = useTasks();
  const task = entries.findLast(
    (entry): entry is TaskNode => entry.id === taskId && isTaskNode(entry),
  );
  if (!task) return null;

  const stepTimings: Partial<Record<AutomaticMergeStepId, AutomaticMergeStepTiming>> = {};
  let currentStep: TaskNode | undefined;
  for (const child of task.children) {
    if (!isTaskNode(child)) continue;
    const stage = steps.find((step) => step.label === child.title);
    if (!stage) continue;
    stepTimings[stage.id] = { startedAt: child.startedAt, endedAt: child.endedAt };
    currentStep = child;
  }
  const currentStepId = steps.find((step) => step.label === currentStep?.title)?.id ?? steps[0]?.id;
  if (!currentStepId) return null;

  return (
    <AutomaticMergeProgress
      currentStepId={currentStepId}
      latestMessage={currentStep && isTaskOpen(currentStep) ? latestLine(currentStep) : undefined}
      startedAt={isTaskOpen(task) ? task.startedAt : undefined}
      elapsedMs={(task.endedAt ?? task.startedAt) - task.startedAt}
      stepTimings={stepTimings}
      steps={steps}
    />
  );
}
