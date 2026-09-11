import { describe, expect, it, vi } from "vitest";

import {
  matchingReviewIssue,
  matchingReviewReturnFilter,
  returnToMatchingReview,
} from "../src/lib/matching-review";

describe("returning to matching review", () => {
  it("reloads the same page before returning without applying or rediscovering", async () => {
    const onFilterChange = vi.fn(async () => {});
    const onReturn = vi.fn();
    const onPageChange = vi.fn(async (page: number) => {
      expect(page).toBe(3);
      expect(onReturn).not.toHaveBeenCalled();
    });
    await returnToMatchingReview({
      filter: { status: "review" },
      page: 3,
      issue: null,
      onFilterChange,
      onPageChange,
      onReturn,
    });
    expect(onFilterChange).not.toHaveBeenCalled();
    expect(onPageChange).toHaveBeenCalledOnce();
    expect(onReturn).toHaveBeenCalledOnce();
  });

  it("stays at reconciliation if loading the conflicting source fails", async () => {
    const onReturn = vi.fn();
    const onPageChange = vi.fn(async () => {});
    const onFilterChange = vi.fn(async () => {
      throw Error("Worker unavailable");
    });
    await expect(
      returnToMatchingReview({
        filter: { status: "blocked", targetId: 9 },
        page: 3,
        issue: { message: "Conflicting targets", source: { entityType: "node", sourceId: 101 } },
        onFilterChange,
        onPageChange,
        onReturn,
      }),
    ).rejects.toThrow("Worker unavailable");
    expect(onFilterChange).toHaveBeenCalledWith({ entityType: "node", sourceId: 101 });
    expect(onPageChange).not.toHaveBeenCalled();
    expect(onReturn).not.toHaveBeenCalled();
  });
  it("uses structured worker conflict details to reveal every alternative for the source", () => {
    const error = {
      message: "Imported way 101 has multiple selected targets: way:101->1, way:101->2",
      conflict: { entityType: "way", sourceId: 101, candidateIds: ["way:101->1", "way:101->2"] },
    };
    const issue = matchingReviewIssue(error);
    expect(issue.message).toBe(error.message);
    expect(matchingReviewReturnFilter({ status: "accepted", targetId: 1 }, issue)).toEqual({
      entityType: "way",
      sourceId: 101,
    });
  });

  it("preserves filters for ordinary backward navigation and non-conflict failures", () => {
    const filter = { entityType: "node", status: "review", sourceId: -101 } as const;
    expect(matchingReviewReturnFilter(filter, null)).toEqual(filter);
    expect(
      matchingReviewReturnFilter(filter, matchingReviewIssue(new Error("Worker unavailable"))),
    ).toEqual(filter);
  });

  it("does not derive source IDs from an error message or malformed metadata", () => {
    for (const conflict of [
      null,
      { entityType: "relation", sourceId: 101 },
      { entityType: "node", sourceId: "101" },
      { entityType: "way", sourceId: Infinity },
    ]) {
      expect(
        matchingReviewIssue({ message: "Imported way 101 failed", conflict }).source,
      ).toBeUndefined();
    }
    expect(matchingReviewIssue(undefined).message).toContain("could not be generated");
  });
});
