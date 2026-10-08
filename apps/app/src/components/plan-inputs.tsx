import {
  ActionButton,
  Alert,
  Checkbox,
  CheckboxLabel,
  Radio,
  RadioCard,
  SidebarSection,
} from "@osmix/ui";
import { useAtom } from "jotai";
import { ListChecksIcon, MergeIcon } from "lucide-react";

import { AUTOMATION_OPTIONS } from "../lib/merge-plan-workflow";
import {
  automationLevelAtom,
  mergeIdenticalPointsAtom,
  patchIdModeAtom,
} from "../state/merge-plan";
import { StepActions } from "./step-actions";

/** Visible names; also the accessible names tests and docs refer to. */
export const MERGE_IDENTICAL_LABEL = "Merge points at identical coordinates automatically";
export const TREAT_AS_NEW_LABEL = "Treat every patch feature as new";

/**
 * The end of the input step: how the plan reads the inputs, then its two entry points. Both
 * plan the same merge; **Review plan** stops for decisions, **Apply automatically** applies
 * the plan as it stands. `tooLarge` says why the browser cannot plan this import; both wait.
 */
export function PlanInputs({
  disabled,
  onApplyAutomatically,
  onReviewPlan,
  tooLarge = null,
}: {
  disabled: boolean;
  tooLarge?: string | null;
  onApplyAutomatically: () => Promise<unknown>;
  onReviewPlan: () => Promise<unknown>;
}) {
  const [mergeIdenticalPoints, setMergeIdenticalPoints] = useAtom(mergeIdenticalPointsAtom);
  const [patchIds, setPatchIds] = useAtom(patchIdModeAtom);
  const [automation, setAutomation] = useAtom(automationLevelAtom);
  return (
    <SidebarSection title="Plan">
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
      <fieldset className="flex flex-col gap-2" aria-describedby="automation-help">
        <legend className="mb-1 font-medium">Automation</legend>
        {AUTOMATION_OPTIONS.map((option) => (
          <RadioCard key={option.value}>
            <Radio
              name="merge-automation"
              aria-describedby={`automation-${option.value}-help`}
              checked={automation === option.value}
              onChange={() => {
                setAutomation(option.value);
                // Conservative decides nothing for you, identical points included.
                setMergeIdenticalPoints(option.value !== "conservative");
              }}
            />
            <span className="flex flex-col">
              <span className="font-medium">{option.label}</span>
              <span id={`automation-${option.value}-help`} className="text-muted-foreground">
                {option.help}
              </span>
            </span>
          </RadioCard>
        ))}
        <p id="automation-help" className="text-muted-foreground">
          Applies to imported-data matching. Removals, changes to the drivable network and
          connections that bend sharply always wait for you, and you can change any automatic choice
          in the review.
        </p>
      </fieldset>
      {tooLarge ? (
        <Alert variant="destructive" title="This import is too large to plan in the browser">
          <p>{tooLarge}</p>
        </Alert>
      ) : null}
      <StepActions aria-label="Plan actions">
        <ActionButton
          variant="outline"
          disabled={disabled || tooLarge !== null}
          icon={<MergeIcon aria-hidden="true" />}
          onAction={onApplyAutomatically}
        >
          Apply automatically
        </ActionButton>
        <ActionButton
          disabled={disabled || tooLarge !== null}
          icon={<ListChecksIcon aria-hidden="true" />}
          onAction={onReviewPlan}
        >
          Review plan
        </ActionButton>
      </StepActions>
      <p className="text-muted-foreground">
        Apply automatically plans and applies in one run. Proposals that need a decision are left
        out and listed in the result.
      </p>
    </SidebarSection>
  );
}
