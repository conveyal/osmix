# 08: Make alternative-target review recoverable

**What to build:** Users can resolve multiple proposed targets for one imported feature and correct an invalid matching decision without restarting their merge. In [PR #218](https://github.com/conveyal/osmix/pull/218), users can accept two targets for one feature; generation rejects the combination, but both available preview buttons retry the same invalid decisions. Make the complete review, validation, correction, and retry path usable for GIS users.

**Blocked by:** None (can start immediately).

**Status:** completed

- [x] First isolate the small workflow transition and decision-preservation logic needed to move between matching review and reconciliation. Keep existing successful flows working; do not make a broad component rewrite a prerequisite.
- [x] Present alternative targets together under their imported feature. Allow at most one selected target for that feature, with an explicit way to leave it unmatched. Choosing a replacement clears only the superseded target decision and preserves unrelated features' decisions.
- [x] Row and bulk review actions cannot create multiple accepted targets for one imported feature. Preserve hard blockers and explain any candidate that cannot be selected.
- [x] Enforce the same single-target invariant at the worker/API boundary so stale, restored, or externally supplied conflicting decisions fail before applying a changeset. Identify the affected imported feature in a useful validation result.
- [x] Provide “Back to matching” from reconciliation and generation failures. Returning preserves loaded data, options, and decisions, and makes the conflicting feature easy to find and correct.
- [x] Correcting the decision and regenerating produces a valid preview without reloading the inputs. Retrying unchanged invalid decisions continues to explain the problem instead of trapping the user in repeated preview attempts.
- [x] Add UI and worker regression tests covering conflicting targets, target replacement, bulk actions, validation failure, backward navigation, preservation of unrelated choices, and successful correction/retry.
- [x] Update workflow documentation to explain that alternatives describe possible correspondences for one imported feature. Run required affected-workspace/dependent checks and visually verify the correction flow.

Verification: affected workspace checks, dependency alignment, 39 documentation examples, and root tests (1,068 passed, 3 existing skips) passed. Merge unit tests passed 67 tests; the full browser suite passed 24 tests. The correction flow was visually inspected at 320 px and 512 px. Regression coverage includes sequential correction of multiple legacy conflicts and worker restart between corrections.
