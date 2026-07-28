import { CheckIcon, CircleIcon } from "lucide-react";

import { cn } from "../lib/utils";
import { Spinner } from "./ui/spinner";

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

export function AutomaticMergeProgress({ currentStepId, steps }: AutomaticMergeProgressState) {
  const currentIndex = steps.findIndex((step) => step.id === currentStepId);
  if (currentIndex === -1) {
    throw Error(`Unknown automatic merge step: ${currentStepId}`);
  }

  const completedCount = currentIndex;
  const currentStep = steps[currentIndex];

  return (
    <div className="rounded-md border bg-card">
      <div className="border-b px-2 py-1.5 font-bold uppercase tracking-wide">Merge progress</div>
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
              <span className="flex size-4 items-center justify-center">
                {status === "completed" ? (
                  <CheckIcon aria-hidden="true" className="size-4 text-success" />
                ) : status === "running" ? (
                  <Spinner aria-hidden="true" className="size-4 text-primary" role="presentation" />
                ) : (
                  <CircleIcon aria-hidden="true" className="size-3" />
                )}
              </span>
              <span className={cn("min-w-0", status === "running" && "font-bold")}>
                {step.label}
              </span>
              <span className="text-[0.65rem] uppercase tracking-wide">
                {status === "completed"
                  ? "Completed"
                  : status === "running"
                    ? "Running"
                    : "Remaining"}
              </span>
            </li>
          );
        })}
      </ol>
    </div>
  );
}
