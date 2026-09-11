# 06: Normalize way direction consistently

**What to build:** Make matching and routing interpret supported one-way tags identically so an imported way cannot be treated as equivalent to a base way with different travel direction. The [PR #218](https://github.com/conveyal/osmix/pull/218) review reproduced a P2 mismatch for roundabouts tagged with oneway values 0 or false.

**Blocked by:** None (can start immediately).

**Status:** completed

- [x] Exact/fuzzy compatibility checks and routing graph construction use the same direction semantics for supported values, including yes, true, 1, no, false, 0, reverse, and -1, and the direction implied by an otherwise unspecified roundabout.
- [x] Reproduce a bidirectional base roundabout with oneway 0 and a nearby forward-only imported roundabout with oneway yes. They are not automatically accepted as direction-equivalent.
- [x] Cover the same mismatch with false, compatible aliases, reverse direction, and an absent explicit one-way value on ordinary ways and roundabouts.
- [x] Confirm direction-sensitive reachability and graph edges before merge, after merge, and after PBF export/reload. Candidate compatibility assertions agree with the routing assertions.
- [x] Keep the shared semantics within the existing package layering; fixing duplication does not introduce a dependency from the change package to the higher-level facade.
- [x] Closed or otherwise ambiguous endpoint orientation cannot certify directed fuzzy matches. Keep bidirectional matches eligible when their remaining tags do not depend on orientation, and verify directed edges rather than reachability alone for closed rings.
- [x] Document supported normalization and any intentionally unsupported values. Targeted regressions and required workspace/dependent checks pass.
