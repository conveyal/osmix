# 14: Make routing verification claims match the evidence

**What to build:** Make route-verification reports distinguish proven node identity and route legality from coordinate matching and diagnostic observations. The [PR #218](https://github.com/conveyal/osmix/pull/218) review found that the local R5 oracle labels a unique coordinate match as an exact OSM-node match, while some access/restriction cases collect diagnostics without asserting route legality.

**Blocked by:** None (can start immediately).

**Status:** completed

- [x] Emit an exact-OSM-node label only when the oracle verifies the requested OSM identity. Otherwise label the resolution as a coordinate match or fallback, preserving ambiguity and missing-vertex outcomes explicitly.
- [x] Manifest node identifiers are either actually used and verified or clearly reported as unverified. Include a case where coincident features cannot be distinguished safely by coordinates alone.
- [x] Reports distinguish asserted route behavior from policy-limitation diagnostics. Diagnostic witnesses are not counted or described as passed access/restriction legality assertions.
- [x] For supported cases advertised as legality checks, capture enough route evidence to assert the claimed reachability, forbidden ways, or prohibited transitions. Demonstrate that an invalid route makes the corresponding check fail.
- [x] Add focused raw, merged, and PBF-reloaded route cases that test these claims. Keep stable OSM evidence in expected results rather than internal graph indexes.
- [x] Retain R5 as an optional local oracle rather than introducing a package or CI dependency. Document how to run the local assertions and accurately record which checks ran or were unavailable.
- [x] Update the routing-test documentation and verification summary vocabulary. Existing automated package tests and required checks pass without requiring large local fixtures or R5.

Verification: all seven affected workspaces passed formatting, type-aware lint, types, and tests/builds: router 56, osmix 270 with 3 existing skips, and Merge 110. Root tests passed 1,202 with 3 existing skips. All 40 documentation examples and dependency alignment for 25 packages passed. Focused routing tests passed 25, including 16 new cases across raw, merged, and PBF-reloaded data. Missing endpoints are unavailable rather than proven unreachable, and algorithms that did not run cannot claim agreement. Local Java self-tests passed 16 scenarios. The optional R5 matrices passed 15 declared checks across ten PBFs, with 65 diagnostic rows kept separate; a deliberate forbidden-way assertion failed and exited 1. R5 checkout provenance and exact scope are recorded in its guide. Final exports have identical decoded entities and manifests to the R5-tested inputs; header timestamps vary because of the separate pre-existing issue recorded in `../additional-findings.md`. Browser tests were not rerun for this test/reporting/documentation-only ticket; the preceding ticket passed all 38.
