# 13: Preserve incompatible entities during exact reconciliation

**What to build:** Preserve distinct imported entities when several exact-coordinate candidates conflict with one another. The [PR #218](https://github.com/conveyal/osmix/pull/218) review reproduced an untagged base node receiving coincident imported cafe and school nodes: both imports disappear and only one classification survives. This is a pre-existing defect that remains after the PR's conservative reconciliation changes.

**Blocked by:** None (can start immediately).

**Status:** completed

- [x] Validate the combined set of proposed replacements for each base target. Compatibility against an initially untagged target does not establish compatibility among all imported sources targeting it.
- [x] Reproduce one untagged base node and two coincident imported nodes classified as cafe and school. Leave the conflicting mappings unapplied so both imported features and their distinct attributes survive.
- [x] Input iteration order and ID ordering cannot decide which conflicting classification is retained. Cover reversed insertion order and multiple contenders for one target.
- [x] Preserve valid exact reconciliation of compatible inputs, authoritative same-ID updates, and the rule that high-level merges do not normalize entities within either original input.
- [x] Check associated way and relation references so declining a conflicting mapping preserves connectivity and reference integrity.
- [x] Verify the result through public and worker-backed merge workflows and after PBF export/reload, with entity and tag assertions in addition to counts.
- [x] Document the group-compatibility requirement and label the regression as a residual pre-existing issue, not a newly introduced PR defect. Required workspace/dependent checks pass.

Verification: nine core regressions reproduced the defect before the fix. The final change adds 11 core and nine public/worker regressions, including full entity/tag/reference assertions after PBF export/reload, insertion and ID order permutations, compatible controls, same-ID updates, diagnostic chains, and a 512-source bounded-work check. Seven affected workspaces passed formatting, type-aware lint, types, and tests/builds: change 316, osmix 254 with 3 existing skips, and Merge 110. Root tests passed 1,186 with 3 existing skips. The complete browser suite passed 38 tests in 40.7 seconds. All 40 documentation examples and dependency alignment for 25 packages passed. Documentation identifies this as a residual pre-existing defect.
