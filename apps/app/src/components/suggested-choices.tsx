import { Button, SidebarSection, useTaskLock } from "@osmix/ui";
import { ListFilterIcon } from "lucide-react";
import { PLAN_CHOICE_GROUPS, type PlanChoiceGroup } from "osmix";

import { CHOICE_GROUP_HELP, CHOICE_GROUP_LABEL } from "../lib/merge-plan-workflow";

/**
 * The features that still need a decision, grouped by why they wait, largest first: each group
 * with its count, what it means, and Show, which narrows the review (and the map) to it so its
 * bulk choices apply to that group alone. The counts add up to the features that need a
 * decision.
 */
export function SuggestedChoices({
  choices,
  group,
  onShow,
}: {
  choices: Record<PlanChoiceGroup, number>;
  group: PlanChoiceGroup | undefined;
  onShow: (group: PlanChoiceGroup | undefined) => unknown;
}) {
  const taskLocked = useTaskLock();
  const groups = PLAN_CHOICE_GROUPS.filter((key) => choices[key] > 0).toSorted(
    (a, b) => choices[b] - choices[a],
  );
  if (groups.length === 0) return null;
  return (
    <SidebarSection flush title="Suggested choices">
      <p className="px-inset pb-2 text-muted-foreground">
        Each feature that needs a decision is in one group. Show a group to decide it with the
        choices below.
      </p>
      <ul className="flex flex-col divide-y border-t" aria-label="Features that need a decision">
        {groups.map((key) => (
          <li key={key} className="flex flex-col gap-1 px-inset py-2">
            <div className="flex items-center justify-between gap-2">
              <span className="font-medium">
                {CHOICE_GROUP_LABEL[key]} ({choices[key].toLocaleString()})
              </span>
              <Button
                size="sm"
                variant={group === key ? "secondary" : "outline"}
                disabled={taskLocked}
                aria-pressed={group === key}
                aria-label={`Show ${CHOICE_GROUP_LABEL[key]}`}
                onClick={() => void onShow(group === key ? undefined : key)}
              >
                <ListFilterIcon aria-hidden="true" />
                {group === key ? "Showing" : "Show"}
              </Button>
            </div>
            <p className="text-muted-foreground">{CHOICE_GROUP_HELP[key]}</p>
          </li>
        ))}
      </ul>
    </SidebarSection>
  );
}
