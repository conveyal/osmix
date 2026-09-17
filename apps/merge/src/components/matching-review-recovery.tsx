import { ActionButton, Card, CardContent, CardHeader } from "@osmix/ui";
import { ArrowLeft } from "lucide-react";

import type { MatchingReviewIssue } from "../lib/matching-review";

export function MatchingReviewProblem({ issue }: { issue: MatchingReviewIssue | null }) {
  if (!issue) return null;
  return (
    <Card role="alert">
      <CardHeader>Matching needs attention</CardHeader>
      <CardContent className="flex flex-col gap-2">
        <p>{issue.message}</p>
        <p>
          Your loaded inputs, options, and saved choices are retained. Review the affected feature,
          then generate the preview again.
        </p>
      </CardContent>
    </Card>
  );
}

/** Available only before applying the cumulative merge to the loaded base. */
export function BackToMatching({ onBack }: { onBack: () => Promise<void> }) {
  return (
    <ActionButton icon={<ArrowLeft />} variant="outline" onAction={onBack}>
      Back to matching
    </ActionButton>
  );
}
