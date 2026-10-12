# Fixtures

Test data shared by package tests (through `@osmix/test-utils/fixtures`) and app e2e specs. Every app's Vite dev server also serves this directory, so `fetch("/monaco.pbf")` works in the browser.

| File                         | What it is                                                                                                                          |
| ---------------------------- | ----------------------------------------------------------------------------------------------------------------------------------- |
| `monaco.pbf`                 | An OpenStreetMap extract of Monaco: 14,286 nodes, 3,346 ways and 46 relations (all turn restrictions). The standard real-data base. |
| `monaco.parquet`             | Monaco as GeoParquet, for `@osmix/geoparquet`.                                                                                      |
| `monaco-gtfs.zip`            | A Monaco GTFS feed, for `@osmix/gtfs`.                                                                                              |
| `monaco-merge-patch.geojson` | A generated patch against `monaco.pbf` that drives each user-visible merge outcome. See below.                                      |

Other `*.pbf` files here are local-only (ignored by Git); tests that need them skip when they are missing.

## `monaco-merge-patch.geojson`

About 30 small scenarios, each in its own part of Monaco, covering direct merge, exact reconciliation, matching (copy tags, connect network, feature-type/geometry/length/grade/one-way conflicts, multiple targets, many-to-one, unmatched), way removal and intersections. It is uploaded as the patch with `monaco.pbf` as the base.

- **Source of truth:** [`packages/test-utils/src/monaco-merge-scenarios.ts`](../packages/test-utils/src/monaco-merge-scenarios.ts) defines each scenario, its geometry relative to real Monaco entities, and its expected outcomes. Don't edit the GeoJSON by hand.
- **Regenerate** after changing a scenario (the file is formatted as part of this):

  ```bash
  pnpm --filter osmix run fixtures:generate:merge-patch
  ```

  `packages/osmix/test/monaco-merge-patch.test.ts` fails if the committed file drifts from what the scenarios produce.

- **Settings:** the tests merge with the default plan (identical points merged, crossings connected) and matching enabled (`MONACO_MERGE_CONFLATION`): the Merge app's default copy keys plus `opening_hours`, `surface` and `level`, connect network on, and removal review on.
- **IDs:** each feature has an explicit ID of −(1,000,000 + scenario number × 100 + k), clear of the importer's automatic vertex IDs (−1, −2, …). Only the replacement scenarios (D2, D3) reuse Monaco IDs.
- **Used by:** the package integration test above (every scenario, in discovery, an automatic merge and a reviewed merge) and the Merge e2e spec [`apps/app/e2e/monaco-merge-patch.spec.ts`](../apps/app/e2e/monaco-merge-patch.spec.ts) (upload through the UI, representative outcomes).

### Out of scope

GeoJSON can't make a relation that references a base entity, and Monaco's relations are all turn restrictions, so these branches are covered by in-code unit tests instead: relation-member review and restriction blocks in matching, `way-removal-relation-member`, and via-node/via-way restriction handling in exact reconciliation and intersections.

### Known issues

Scenarios that expose a merge bug go in `MONACO_MERGE_KNOWN_ISSUES`, outside the main patch (one failure would stop the whole merge), each with a skipped test that reproduces it. Unskip the test with the fix. There are none at the moment: the first, K1 (connect network attaching into a junction with grade-separated ways), is fixed and is now scenario A4.
