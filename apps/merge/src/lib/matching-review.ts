import type { OsmConflationCandidateFilter } from "osmix";

export interface MatchingReviewIssue {
  message: string;
  source?: { entityType: "node" | "way"; sourceId: number };
}

/** Read worker error details without relying on an Error subclass crossing Comlink. */
export function matchingReviewIssue(error: unknown): MatchingReviewIssue {
  const message =
    error && typeof error === "object" && "message" in error && typeof error.message === "string"
      ? error.message
      : "The matching preview could not be generated. Try again or review your choices.";
  const issue: MatchingReviewIssue = { message };
  if (!error || typeof error !== "object" || !("conflict" in error)) return issue;
  const conflict = error.conflict;
  if (
    conflict &&
    typeof conflict === "object" &&
    "entityType" in conflict &&
    (conflict.entityType === "node" || conflict.entityType === "way") &&
    "sourceId" in conflict &&
    typeof conflict.sourceId === "number" &&
    Number.isSafeInteger(conflict.sourceId)
  ) {
    issue.source = { entityType: conflict.entityType, sourceId: conflict.sourceId };
  }
  return issue;
}

/** Clear unrelated filters only when a failed preview identifies a source to correct. */
export function matchingReviewReturnFilter(
  current: OsmConflationCandidateFilter,
  issue: MatchingReviewIssue | null,
): OsmConflationCandidateFilter {
  return issue?.source ? { ...issue.source } : { ...current };
}

/** Reload review context before navigating, without rediscovering or changing any input. */
export async function returnToMatchingReview({
  filter,
  page,
  issue,
  onFilterChange,
  onPageChange,
  onReturn,
}: {
  filter: OsmConflationCandidateFilter;
  page: number;
  issue: MatchingReviewIssue | null;
  onFilterChange: (filter: OsmConflationCandidateFilter) => Promise<void>;
  onPageChange: (page: number) => Promise<void>;
  onReturn: () => void;
}) {
  if (issue?.source) await onFilterChange(matchingReviewReturnFilter(filter, issue));
  else await onPageChange(page);
  onReturn();
}
