# 03: Keep hard match blockers authoritative

**What to build:** Keep unsafe matches blocked regardless of additional review reasons or user acceptance. The [PR #218](https://github.com/conveyal/osmix/pull/218) review reproduced a P2 failure where membership in an ordinary route relation changes an already blocked grade-conflicting way match into a reviewable match, allowing its tags to transfer.

**Blocked by:** None (can start immediately).

**Status:** completed

- [x] Adding relation membership, ambiguity, or another review reason never weakens an action that is already blocked. Preserve all useful reasons when combining assessments.
- [x] Reproduce an imported bridge with layer 1 in a walking-route relation beside a ground-level base footway. Its grade-conflicting transfer remains blocked during discovery, candidate paging, and changeset generation.
- [x] Explicit acceptance cannot apply the blocked transfer, and filter-wide acceptance skips it with accurate eligible/skipped counts. No base tags or imported topology change as a result of the blocked action.
- [x] Cover source and target relation membership, ordinary and restriction relations, and combined grade, access, protected-tag, and geometry conflicts wherever those are existing hard blockers.
- [x] A compatible match that requires review solely because of ordinary relation membership remains reviewable. Preserve action-specific eligibility when one action is safe and the other is blocked.
- [x] API results, worker recovery, and Merge status explanations agree that review cannot override hard safety rules.
- [x] Add combined-condition regressions and update safety documentation. Required workspace and dependent checks pass.
