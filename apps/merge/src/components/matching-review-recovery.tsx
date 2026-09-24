import { ActionButton, Alert } from "@osmix/ui";
import { ArrowLeftIcon } from "lucide-react";

import type { MatchingReviewIssue } from "../lib/matching-review";

export function MatchingReviewProblem({ issue }: { issue: MatchingReviewIssue | null }) {
  if (!issue) return null;
  return (
    <Alert variant="destructive" title="Matching needs attention">
      <p>{issue.message}</p>
      <p>
        Your loaded inputs, options, and saved choices are retained. Review the affected feature,
        then generate the preview again.
      </p>
    </Alert>
  );
}

/** Available only before applying the cumulative merge to the loaded base. */
export function BackToMatching({ onBack }: { onBack: () => Promise<void> }) {
  return (
    <ActionButton icon={<ArrowLeftIcon />} variant="outline" onAction={onBack}>
      Back to matching
    </ActionButton>
  );
}
