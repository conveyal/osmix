import { Button, Card, CardContent, CardHeader, Checkbox, CheckboxLabel } from "@osmix/ui";
import { useAtom } from "jotai";
import { ListChecksIcon, MergeIcon } from "lucide-react";

import { mergeIdenticalPointsAtom, patchIdModeAtom } from "../state/merge-plan";
import { StepActions } from "./step-actions";

/** Visible names; also the accessible names tests and docs refer to. */
export const MERGE_IDENTICAL_LABEL = "Merge points at identical coordinates automatically";
export const TREAT_AS_NEW_LABEL = "Treat every patch feature as new";

/**
 * The end of the input step: how the plan reads the inputs, then its two entry points. Both
 * plan the same merge; **Review plan** stops for decisions, **Apply automatically** applies
 * the plan as it stands.
 */
export function PlanInputs({
  disabled,
  onApplyAutomatically,
  onReviewPlan,
}: {
  disabled: boolean;
  onApplyAutomatically: () => unknown;
  onReviewPlan: () => unknown;
}) {
  const [mergeIdenticalPoints, setMergeIdenticalPoints] = useAtom(mergeIdenticalPointsAtom);
  const [patchIds, setPatchIds] = useAtom(patchIdModeAtom);
  return (
    <Card role="region" aria-labelledby="merge-plan-title">
      <CardHeader id="merge-plan-title">Plan</CardHeader>
      <CardContent className="flex flex-col gap-2">
        <div className="flex flex-col gap-1">
          <CheckboxLabel className="min-h-8">
            <Checkbox
              checked={mergeIdenticalPoints}
              aria-describedby="merge-identical-help"
              onCheckedChange={setMergeIdenticalPoints}
            />
            {MERGE_IDENTICAL_LABEL}
          </CheckboxLabel>
          <p id="merge-identical-help" className="text-muted-foreground">
            An imported point at a base point's exact position becomes that base point, and an
            imported way that then matches a base way becomes it. When off, each of these waits for
            your decision in the review.
          </p>
        </div>
        <div className="flex flex-col gap-1">
          <CheckboxLabel className="min-h-8">
            <Checkbox
              checked={patchIds === "new"}
              aria-describedby="treat-as-new-help"
              onCheckedChange={(checked) => setPatchIds(checked ? "new" : "osm")}
            />
            {TREAT_AS_NEW_LABEL}
          </CheckboxLabel>
          <p id="treat-as-new-help" className="text-muted-foreground">
            A positive patch ID normally edits the base entity with that ID. Turn this on when the
            patch's IDs are not edits of the base.
          </p>
        </div>
        <StepActions aria-label="Plan actions">
          <Button variant="outline" disabled={disabled} onClick={() => void onApplyAutomatically()}>
            <MergeIcon aria-hidden="true" />
            Apply automatically
          </Button>
          <Button disabled={disabled} onClick={() => void onReviewPlan()}>
            <ListChecksIcon aria-hidden="true" />
            Review plan
          </Button>
        </StepActions>
        <p className="text-muted-foreground">
          Apply automatically plans and applies in one run. Proposals that need a decision are left
          out and listed in the result.
        </p>
      </CardContent>
    </Card>
  );
}
