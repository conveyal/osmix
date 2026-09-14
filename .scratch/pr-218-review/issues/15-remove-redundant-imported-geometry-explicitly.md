# 15: Remove redundant imported geometry explicitly

**What to build:** Give users a separate, previewed action for removing a redundant imported way after establishing that the retained network preserves its required connections. This implements the approved [PR #218](https://github.com/conveyal/osmix/pull/218) review decision that copying tags preserves geometry and geometry removal requires its own explicit choice.

**Blocked by:** 01 — Copy tags without changing geometry.

**Status:** completed

- [x] Geometry removal is disabled by default and is independently selected from copying tags and connecting the network. Existing callers that only request those matching actions do not remove imported ways.
- [x] Expose the choice through the supported public matching workflow, worker review, and Merge UI. Before application, identify the imported way to remove, the retained base counterpart, any orphan-node cleanup, and the verified connectivity consequences.
- [x] Permit removal only for a supported one-to-one equivalent way with compatible routing meaning. One-to-many chains remain unsupported, and existing hard match blockers cannot be overridden.
- [x] Check all connections from the imported way to retained ways and relations. A matched trunk with unmatched branches cannot disappear while leaving those branches disconnected; changing tag selections cannot bypass this check.
- [x] Preserve turn restrictions and grade-separated topology. Block removal when equivalence or connectivity cannot be established, with an actionable explanation that leaving the imported geometry is safe.
- [x] Remove only eligible untagged, unreferenced imported nodes orphaned by an accepted removal. Preserve tagged nodes, referenced nodes, unrelated imports, and authoritative base entities.
- [x] Decisions and previews survive worker recovery; stale decisions are invalidated when input contents change. Applied removal and retained connectivity remain correct after PBF export/reload.
- [x] Demonstrate both a safe standalone duplicate removal and a blocked branching-network removal, plus an allowed removal whose explicitly accepted connections preserve the branches. Cover API and UI behavior, update guidance and the attribute/topology ADR, and pass required workspace/dependent checks.

Verification: all seven affected workspaces passed formatting, type-aware lint, types, and tests/builds: change 345, osmix 282 with 3 existing skips, and Merge 115. Root tests passed 1,243 with 3 existing skips. All 41 documentation examples and dependency alignment for 25 packages passed. The full ordered browser suite passed 42 tests in 46.5 seconds, including a real manual Comlink journey, explicit connection confirmation, stale-preview invalidation after rediscovery, keyboard/pending-state behavior, and 320/512-pixel layouts.

Coverage includes 29 new core cases and 12 facade/worker cases: standalone and branch-dependent removal, original and final topology checks, relation/restriction involvement, grade and semantic conflicts, reversed direction-dependent keys/values, ignored rejection flags, copy actions preserving implicit connections, explicit bulk connection persistence, scoped orphan cleanup, pending-create cancellation, input invalidation, detached previews/outcomes, atomic rejected edits, worker recovery, and PBF reload. Copying and connecting never implicitly select removal. The original attribute/topology ADR, glossary, package/app guides, and patch release note describe the conservative supported scope.

The optional R5 oracle was not rerun for this opt-in action. Its ticket 14 results remain separately scoped; the new removal cases assert actual entities, references, and PBF round trips. The pre-existing export timestamp finding remains documented separately in `../additional-findings.md`.
