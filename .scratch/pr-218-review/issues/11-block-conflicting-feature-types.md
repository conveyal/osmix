# 11: Block matches between conflicting feature types

**What to build:** Prevent nearby but semantically different features from being presented as usable matches. The approved policy from the [PR #218](https://github.com/conveyal/osmix/pull/218) review is to block conflicting feature types, including an imported school point beside a base cafe, even when their distance and routing context otherwise permit matching.

**Blocked by:** None (can start immediately).

**Status:** completed

- [x] Compare explicit feature classifications independently of the tag keys selected for copying. Selecting only name cannot hide a school-versus-cafe identity conflict.
- [x] A candidate with conflicting feature types remains blocked for matching actions, including manual and bulk acceptance. Show a specific feature-type conflict reason in API evidence and the Merge review.
- [x] Treat missing classification information as unknown rather than an explicit conflict; retain other existing eligibility checks. Document which classifications and compatibility rules are supported so high-confidence wording has a concrete meaning.
- [x] Cover incompatible classifications within the matching radius, compatible classifications with different descriptive values, and a classification present on only one side. Include relation membership so an additional review reason cannot override the semantic block.
- [x] A blocked match does not remove the imported feature or prevent its ordinary direct-merge addition. Same-ID authoritative updates retain their documented behavior.
- [x] Tests cover discovery, public generation, worker review, and attempted manual/bulk actions. The school/cafe scenario never copies the imported name onto the cafe.
- [x] Update matching guidance and the glossary to explain that proximity proposes candidates but does not establish feature identity. Required workspace/dependent checks pass.

Verification: the school/cafe regression failed before the fix in discovery, public generation, and worker review, then passed with both actions blocked. All seven affected workspaces passed formatting, type-aware lint, types, and tests/builds; change tests passed 297, osmix passed 227 with 3 existing skips, and Merge passed 110. Root tests passed 1,140 with 3 existing skips. Dependency alignment passed for 25 packages and 39 documentation examples passed. The complete ordered browser suite passed 38 tests in 39.6 seconds; E2E sources passed TypeScript. The conflict reason, original classification values, and disabled actions were visually inspected at 320 px and 512 px, with screenshots retained in `output/playwright/ticket11/`. Coverage includes all 19 supported keys, generic/absent classifications, relation membership, attachment-only matching, manual/bulk attempts, detached worker evidence, retained imported entities, and same-ID updates.
