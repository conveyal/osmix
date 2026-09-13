# 10: Make match evidence understandable and accessible

**What to build:** GIS users can understand why a correspondence was proposed, distinguish the base and imported features on the map, and operate review controls with a keyboard or assistive technology. Address the confusing distance display, map evidence, terminology, help associations, and typography identified in [PR #218](https://github.com/conveyal/osmix/pull/218).

**Blocked by:** None (can start immediately).

**Status:** completed

- [x] Replace non-finite distance output such as “Infinity m” with meaningful states. Use “No target within search radius” when that is the actual condition, and a separate unavailable-distance explanation when a target exists but its distance is unknown. Continue to show valid finite distances with units.
- [x] Give base and imported features distinct marker shapes as well as colors. Provide a visible legend and corresponding text labels so identification never depends on color alone.
- [x] Show readable, selectable coordinates for the relevant features, label latitude and longitude explicitly, and keep map highlighting and textual evidence consistent when the selection changes.
- [x] Lead with familiar feature, attribute, and connection language. Explain OSM-specific concepts such as tags, nodes, ways, and proposed matches where needed; keep detailed identifiers and graph metrics available as secondary evidence.
- [x] Associate each affected input with its visible label and help/error text using the appropriate accessible relationships, including `aria-describedby`. Ensure controls, selection states, focus feedback, and the evidence panel remain understandable through keyboard navigation and screen-reader inspection.
- [x] Use the merge app's documented typography and layout conventions for the revised controls and evidence; verify readable wrapping and usable layout at narrow widths.
- [x] Add focused tests for missing/non-finite/finite distances, accessible control names and descriptions, and evidence updates after selection changes. Visually verify marker distinction, legend, typography, and responsive behavior; include a screenshot for the UI changes.
- [x] Update user-facing evidence documentation and glossary explanations, then run required formatting, lint, type, and test checks for affected workspaces and their dependents.

Verification: all six affected workspaces passed formatting, type-aware lint, types, and tests/builds. Final Merge checks passed after the keyboard fixes. Dependency alignment passed for 25 packages; 39 documentation examples passed. Root tests passed 1,096 tests with 3 existing skips; Merge unit tests passed 108 tests. The full ordered browser suite passed 37 tests in 39.7 seconds, and E2E sources passed their focused TypeScript check. Browser regressions cover field-specific errors and start-action focus, repeated radio and checkbox keyboard choices, pending mutation guards, permanent disabled semantics, high-contrast focus, distance states, and consistent map/text selection. Invalid WGS 84 coordinates and incomplete ways are omitted from comparison geometry instead of crashing the map or inventing segments. Coincident shapes and way evidence were visually inspected at 320 px and 512 px; screenshots are retained in `output/playwright/ticket10/`.
