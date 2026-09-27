import {
  Button,
  Card,
  CardContent,
  CardHeader,
  Checkbox,
  CheckboxLabel,
  InfoTooltip,
} from "@osmix/ui";
import { useAtom } from "jotai";

import { automaticMergeAtom } from "../state/conflation";

const HELP_ID = "automatic-mode-help";

/** The checkbox's visible name; also its accessible name in tests and docs. */
export const AUTOMATIC_LABEL = "Run every stage automatically, without review";

/**
 * The end of the input step: the automatic-mode checkbox (what it runs lives in its tooltip) and
 * the one "Start merge" button. Removal review needs the reviewed workflow, so it disables the
 * checkbox without forgetting the stored choice.
 */
export function MergeStart({
  disabled,
  matchingEnabled,
  onStart,
  requiresRemovalReview,
}: {
  disabled: boolean;
  matchingEnabled: boolean;
  onStart: (automatic: boolean) => unknown;
  requiresRemovalReview: boolean;
}) {
  const [automatic, setAutomatic] = useAtom(automaticMergeAtom);
  const effectiveAutomatic = automatic && !requiresRemovalReview;

  return (
    <Card role="region" aria-labelledby="merge-workflow-title">
      <CardHeader id="merge-workflow-title">Workflow</CardHeader>
      <CardContent className="flex flex-col gap-2">
        <div className="flex items-center gap-1">
          <CheckboxLabel className="min-h-8">
            <Checkbox
              checked={effectiveAutomatic}
              disabled={requiresRemovalReview}
              id="automatic-mode"
              aria-describedby={requiresRemovalReview ? HELP_ID : undefined}
              onCheckedChange={setAutomatic}
            />
            {AUTOMATIC_LABEL}
          </CheckboxLabel>
          <InfoTooltip label="About running every stage automatically" side="right" align="start">
            <div className="flex flex-col gap-2">
              <p>
                Uses the same merge rules and safety validation as the reviewed workflow, without
                pausing for inspection and approval. One run:
              </p>
              <ul className="flex list-disc flex-col gap-1 pl-4">
                <li>
                  Generates and applies the direct merge with exact reconciliation, without a
                  preview.
                </li>
                <li>
                  {matchingEnabled
                    ? "Discovers imported-data matches and applies only high-confidence ones. Candidates that need review are reported as unresolved."
                    : "Proximity matching stays off unless you enable it above."}
                </li>
                <li>Creates and applies safe intersections.</li>
                <li>Refreshes the merged dataset and shows the completion summary.</li>
                <li>Cancel stops the run only until the first change is applied.</li>
              </ul>
              <p>
                When off, each stage pauses so you can inspect and approve its changes before the
                base changes.
              </p>
            </div>
          </InfoTooltip>
        </div>

        {requiresRemovalReview ? (
          <p id={HELP_ID} className="text-muted-foreground">
            Unavailable while redundant way removal review is on: removals are selected and
            previewed in the reviewed workflow.
          </p>
        ) : null}

        <Button
          className="w-full"
          disabled={disabled}
          onClick={() => void onStart(effectiveAutomatic)}
        >
          Start merge
        </Button>
      </CardContent>
    </Card>
  );
}
