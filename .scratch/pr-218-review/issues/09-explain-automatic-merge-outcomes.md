# 09: Explain automatic merge outcomes

**What to build:** An automatic merge can complete with ambiguous or blocked matches while prominently explaining what actually changed and what remains unresolved before the user downloads the result. For GIS users importing sidewalks or accessibility data, completion must not imply that every candidate matched or every selected attribute transferred. Extend the outcome reporting and completion experience reviewed in [PR #218](https://github.com/conveyal/osmix/pull/218).

**Blocked by:** None (can start immediately).

**Status:** completed

- [x] Show a prominent completion summary before download with actual applied tag-copy and network-connection actions, plus unresolved imported features. Distinguish ambiguous matches, blocked matches, and user-skipped matches rather than counting all non-applied candidates as failures.
- [x] Derive applied totals from the generated/applied result, not candidate eligibility or the number of scheduled actions. Clearly distinguish feature counts from action counts and avoid counting alternative targets as separate imported features.
- [x] Report which user-selected accessibility tags were not copied, with affected-feature counts and available reasons such as no accepted target, a blocked action, or the configured conflict policy. Provide enough detail to locate the affected features without crowding the main summary.
- [x] Explain which imported features remain in the merged output when matching is skipped or unresolved, including ordinary imported additions. Do not imply that skipping a proposed correspondence discards the imported feature.
- [x] Allow download after a successful merge with unresolved candidates, consistent with the user's chosen completion policy. Retain readable unresolved-feature details from that run; any retry must start from the original inputs rather than reapply the completed merge to its own result. Failed generation never displays a successful completion summary.
- [x] Test fully applied, mixed, all-unresolved, and zero-candidate outcomes, selected tags left uncopied, alternative-target counting, retained additions, and recomputation after decisions change. Verify the displayed summary against worker outcomes and the resulting dataset.
- [x] Update workflow documentation/glossary with the distinction between scheduled, applied, unresolved, and retained. Use plain GIS-oriented language; technical graph metrics remain secondary and do not claim route correctness.
- [x] Run required checks for affected workspaces and dependents, and visually verify the summary and download flow.

Verification: all seven affected workspaces passed formatting, type-aware lint, types, and tests/builds. Dependency alignment passed for 25 packages; 39 documentation examples passed. Root tests passed 1,096 tests with 3 existing skips; Merge unit tests passed 84 tests. The full browser suite passed 30 tests in 31.5 seconds. Completion details and downloads were visually inspected at 320 px and 512 px. Regressions cover actual surviving tag values, ordinary retained additions, decision recomputation, committed worker synchronization failures, post-rename refresh retry, late cancellation, and shared-input replacement. The Yakima fixture verifies that every existing crossing classification survives intersections; the fix avoids 68 prior crossing-only rewrites.
