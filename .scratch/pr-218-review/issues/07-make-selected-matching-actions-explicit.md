# 07: Make selected matching actions explicit

**What to build:** GIS users importing sidewalk or accessibility data can independently choose to copy tags and connect networks, and can see exactly which actions their current decisions schedule. In [PR #218](https://github.com/conveyal/osmix/pull/218), selecting property transfer disables attachment while the row can still say attachment is automatic; rejected matches retain automatic labels, and row and bulk actions combine differently. Resolve these contradictions across review controls, saved decisions, worker inputs, and regenerated previews.

**Blocked by:** None (can start immediately).

**Status:** completed

- [x] First extract the narrow decision-resolution logic needed by row controls, bulk controls, and action labels so they use one interpretation of saved decisions. Keep the refactor behavior-preserving and avoid a broad workflow rewrite.
- [x] Provide independent, clearly labeled “Copy tags” and “Connect network” controls wherever each action is eligible. Changing one action preserves the other choice; applying an equivalent bulk action produces the same effective decisions.
- [x] Distinguish discovery eligibility from scheduled actions. Accepted rows describe what will run, skipped or rejected rows show no scheduled matching actions, and blocked actions explain why they cannot be selected. “Automatic” never implies an action has already been applied.
- [x] Persist the effective action choices through navigation, preview regeneration, and worker requests. Rows and the preview agree after modifying or clearing a prior decision.
- [x] Add interaction tests for copy-only, connect-only, both, neither, rejection, blocked actions, and equivalent row/bulk changes. Verify that the worker receives the choices shown to the user.
- [x] Update review documentation and the glossary: a candidate proposes a correspondence; automatic means scheduled; copying tags transfers attributes; connecting networks changes connectivity; skipping a match retains ordinary imported additions under the existing merge rules. Explain OSM tags in language suitable for GIS users.
- [x] Run the required formatting, lint, type, and test checks for affected workspaces and their dependents, and include a UI screenshot or equivalent visual verification.

Verification: affected workspace checks, dependency alignment, 39 documentation examples, and root tests (1,041 passed, 3 existing skips) passed. The full Merge browser suite passed 21 tests; screenshots at 320 px and 512 px were visually inspected.
