# 12: Reject unsupported conflation generation options

**What to build:** Give callers an explicit result when they request matching through an unsupported generation API. The [PR #218](https://github.com/conveyal/osmix/pull/218) review found that ordinary changeset generation accepts conflation through its shared option type but silently ignores it, making a successful preview look as though the requested matching ran.

**Blocked by:** None (can start immediately).

**Status:** completed

- [x] Ordinary changeset generation rejects a supplied conflation configuration with an actionable error directing callers to the supported conflation-generation or high-level merge workflow.
- [x] The ordinary-generation public option type does not advertise unsupported conflation configuration. Keep runtime validation for JavaScript, RPC, and structurally wider option objects that can bypass a compile-time excess-property check.
- [x] The rejection occurs before replacing an existing generated preview or changing dataset state. Existing ordinary generation without conflation remains compatible.
- [x] Worker and remote callers receive the same clear error rather than a successful ordinary preview. The facade exports and documented examples agree with the supported APIs.
- [x] Supported conflation generation still applies requested matching and exposes its expected review and validation behavior; this ticket does not add fuzzy matching to the ordinary generator.
- [x] Add runtime and type-level coverage for unsupported configuration, ordinary valid options, and supported conflation calls. Run the required checks for changed workspaces and their dependents.

Verification: ordinary generation, worker, and remote regression cases failed before the fix and now pass. All seven affected workspaces passed formatting, type-aware lint, types, and tests/builds; change passed 305 tests, osmix passed 245 with 3 existing skips, and Merge passed 110. Root tests passed 1,166 with 3 existing skips; dependency alignment passed for 25 packages. All 40 documentation examples passed, including the new ordinary-options type import. The complete ordered browser suite passed 38 tests in 42.9 seconds. Tests cover structurally wider typed options, null/false and inherited/non-enumerable/non-cloneable configuration, consistent early errors, preserved ordinary and matching previews and recovery, untouched decisions/filters/datasets, undefined compatibility, and supported matching calls. Type checks verify ordinary API signatures omit conflation while matching APIs retain it.
