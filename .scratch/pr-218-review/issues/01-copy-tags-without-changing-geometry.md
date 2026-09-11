# 01: Copy tags without changing geometry

**What to build:** Let GIS users copy selected imported attributes onto matched base features while preserving imported geometry and connectivity. The [PR #218](https://github.com/conveyal/osmix/pull/218) review reproduced a P1 failure: copying a name with network connection disabled removes a matched imported trunk and disconnects its branches. The approved product decision is that copying tags and removing redundant geometry are separate actions.

**Blocked by:** None (can start immediately).

**Status:** completed

- [x] Relative to the ordinary direct/exact merge baseline, copying tags changes only selected tag values. It does not create or remove entities or change coordinates, way references, or relation members.
- [x] Missing imported values do not delete base values, unselected tags remain unchanged, and existing protected-tag and review requirements still apply.
- [x] Automatic, individually accepted, and bulk tag-copy decisions obey the same geometry-preservation rule through the public merge APIs and worker-backed Merge workflow.
- [x] Reproduce a base way with nodes 1 and 2, a nearby imported trunk with nodes 101, 102, and 103, and imported branches joining 104 to 101 and 103 to 105. With only name copying enabled and network connection disabled, route 104 to 105 remains reachable and the imported trunk remains present.
- [x] Verify the branch fixture before merge, after application, and after PBF export/reload. Assert the retained way references as well as route reachability.
- [x] Update user guidance and API documentation so copying tags never promises or implies geometry removal. Establish the glossary definition of copying tags and record an ADR explaining the decision to separate attribute updates from topology-changing removal.
- [x] Keep the separate removal feature in ticket 15; this fix can ship with all imported geometry retained.
- [x] Targeted regressions and the repository-required formatting, lint, type, and test checks pass for changed workspaces and their dependents.
