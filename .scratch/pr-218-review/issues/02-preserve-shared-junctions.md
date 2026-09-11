# 02: Preserve shared junctions during intersection creation

**What to build:** Create safe intersections without breaking an existing imported junction, bridge entrance, or turn restriction. The [PR #218](https://github.com/conveyal/osmix/pull/218) review reproduced a P1 regression where reusing a base endpoint moves only the imported surface way, leaving its connecting bridge behind; adding a valid restriction makes the merge fail instead.

**Blocked by:** None (can start immediately).

**Status:** completed

- [x] Endpoint reuse considers every incident way and affected restriction before rewriting references. Existing base and imported connectivity survives the operation.
- [x] Reproduce a base surface way joining nodes 1 and 2, an imported surface way joining 5 and 6, and an imported bridge joining 5 and 7, with nodes 2 and 5 coincident. Direct merge plus intersection creation preserves the connection between the imported surface way and bridge.
- [x] Adding a valid restriction from the imported surface way, via node 5, to the bridge remains valid after merging. Its via-node and participating ways agree; a global restriction rewrite cannot leave one participating way behind.
- [x] Cover multiple incident ways and more than one restriction at the shared endpoint. An unsafe endpoint substitution preserves the original junction rather than partially rewiring it.
- [x] Preserve legitimate bridge-portal connections without creating connections at grade-separated interior crossings. Keep existing grade-separation and degenerate-way safeguards effective.
- [x] Verify connectivity, references, and restriction topology after direct API merge and worker application, including PBF export/reload.
- [x] Document the distinction between preserving an existing junction and creating a new crossing, with related entity IDs in actionable validation errors.
- [x] Targeted regressions and the repository-required checks pass for changed workspaces and their dependents.
