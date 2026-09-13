# Local R5 routing oracle

This optional local runner compares exported Osmix routing cases with a specific R5 checkout using `TransportNetwork.fromFiles`, `StreetRouter`, and `StreetMode.CAR` or `StreetMode.WALK`. Results describe that checkout's graph, linking, and policy behavior for the supplied fixtures. R5 is not part of Osmix's package or CI dependency graph, and matching route measurements do not establish general route legality.

The checked-in Osmix expectations cover topology, required/forbidden ways, bounded measurements, and Dijkstra/A* agreement. Two default-profile Osmix cases intentionally document policy limitations:

- `monaco-motor-vehicle-access`: the default Osmix vehicle profile does not enforce `motor_vehicle=no` on way `158215187`.
- `monaco-no-left-turn-restriction`: the Osmix graph does not interpret `no_left_turn` relation `4261963`.

These diagnostic rows can request separate R5 checks. Their outcomes are reported independently and do not turn the Osmix limitation into a passed policy assertion.

The Osmix implicit-roundabout and reverse-oneway cases assert declared reachability, required ways, and bounded measurements. Those checks cover their fixture expectations; they do not establish every access or turn-restriction rule. An R5 observation is an additional comparison, not an automatic pass for the Osmix assertion.

The test-only Osmix WALK graph changes highway eligibility and speeds, but the generic
`RoutingGraph` still applies way-level `oneway` and roundabout direction. R5 WALK observations must be interpreted using their endpoint resolution and explicitly evaluated checks.

The synthetic access-aware fixture uses a test-only car filter that rejects `no`/`private` according to `motorcar`, `motor_vehicle`, `vehicle`, then `access` precedence. Its declared forbidden-way and transition checks establish the fixture's detour, without adding conditional access, barriers, or complete vehicle/turn-restriction policy to the default router.

## 1. Export the inputs and matrix from Osmix

Run from the Osmix repository. Use a fresh temporary directory because R5 creates MapDB sidecar
files beside each input PBF.

```sh
OSMIX_DIR="$PWD"
ORACLE_DIR="$(mktemp -d /tmp/osmix-r5-oracle.XXXXXX)"
OSMIX_ROUTING_ORACLE_DIR="$ORACLE_DIR" \
  pnpm -w exec vitest run --project osmix \
  packages/osmix/test/routing-after-merge.test.ts
```

This opt-in command writes:

- `routing-cases.tsv`: every case's mode, requested OSM node IDs, exported coordinates, Osmix endpoint resolution, and separately declared R5 checks. Resolved Osmix coordinates are used when available; otherwise the original coordinate request or existing OSM node coordinates are used. Missing node coordinates remain blank instead of dropping the case.
- Raw, empty-merged, synthetic-patched, and reloaded Monaco PBFs: exact oracle inputs.
- `oracle-matrix.json`: current Osmix raw, merged, and PBF-reloaded reports.
- Per-dataset `routing-report.json`, `routing-verification.json`, and GeoJSON evidence. The matrix has `schemaVersion: 2` and includes each dataset's verification summary.
- `synthetic/`: generated merged and PBF-reloaded synthetic networks and reports.
- `conflation-property/`: ordinary, property-only, and property-only-reloaded PBFs. Their
  disconnected WALK topology must remain identical.
- `conflation-attachment/`: attached and attached-reloaded pedestrian PBFs. Both must expose the
  newly connected WALK route.

The main routing suite writes persistent review artifacts only when `OSMIX_ROUTING_ORACLE_DIR` is set. Exporter regression tests use a temporary directory and remove it afterward; no command auto-updates checked-in expectations. Normal package and CI tests use checked-in Monaco and small generated networks, require no persistent outputs, and do not need a local R5 checkout or the large optional Yakima/Eastern Washington fixtures.

## 2. Run the same matrix through a local R5 checkout

Run from the R5 repository. The init script adds only a temporary source set and task. Supplying a
temporary build directory keeps generated R5 build files out of the adjacent checkout.

```sh
R5_ORACLE_BUILD="$(mktemp -d /tmp/osmix-r5-build.XXXXXX)"
gradle --offline --no-daemon --init-script \
  "$OSMIX_DIR/packages/osmix/test/r5/r5-oracle.init.gradle" \
  -PosmixOracleBuildDir="$R5_ORACLE_BUILD" \
  -PosmixOracleSourceDir="$OSMIX_DIR/packages/osmix/test/r5" \
  testOsmixRoutingOracle

gradle --no-daemon --init-script \
  "$OSMIX_DIR/packages/osmix/test/r5/r5-oracle.init.gradle" \
  -PosmixOracleBuildDir="$R5_ORACLE_BUILD" \
  -PosmixOracleSourceDir="$OSMIX_DIR/packages/osmix/test/r5" \
  -PosmixOracleManifest="$ORACLE_DIR/routing-cases.tsv" \
  -PosmixOracleOutputDir="$ORACLE_DIR" \
  runOsmixRoutingOracle
```

Use `--offline` when the R5 Gradle dependencies are already cached; omit it when they must be resolved. `testOsmixRoutingOracle` checks endpoint labeling, manifest parsing, and positive/negative assertion cases without loading the matrix. The matrix runner produces one TSV per dataset in `ORACLE_DIR`.

The init script accepts a comma-separated `osmixOracleDatasets` override for the generated
conflation variants. Run the property-only matrix and attachment matrix separately so each uses its
matching endpoint expectations:

```sh
gradle --offline --no-daemon --init-script \
  "$OSMIX_DIR/packages/osmix/test/r5/r5-oracle.init.gradle" \
  -PosmixOracleBuildDir="$R5_ORACLE_BUILD" \
  -PosmixOracleSourceDir="$OSMIX_DIR/packages/osmix/test/r5" \
  -PosmixOracleManifest="$ORACLE_DIR/conflation-property/routing-cases.tsv" \
  -PosmixOracleOutputDir="$ORACLE_DIR/conflation-property" \
  -PosmixOracleDatasets=synthetic-conflation-ordinary,synthetic-conflation-property,synthetic-conflation-property-roundtrip \
  runOsmixRoutingOracle

gradle --offline --no-daemon --init-script \
  "$OSMIX_DIR/packages/osmix/test/r5/r5-oracle.init.gradle" \
  -PosmixOracleBuildDir="$R5_ORACLE_BUILD" \
  -PosmixOracleSourceDir="$OSMIX_DIR/packages/osmix/test/r5" \
  -PosmixOracleManifest="$ORACLE_DIR/conflation-attachment/routing-cases.tsv" \
  -PosmixOracleOutputDir="$ORACLE_DIR/conflation-attachment" \
  -PosmixOracleDatasets=synthetic-conflation-attachment,synthetic-conflation-attachment-roundtrip \
  runOsmixRoutingOracle
```

The primary `coordinate_*` results use R5 coordinate-to-edge linking. A requested OSM node ID is retained in `origin_requested_osm_node_id` or `destination_requested_osm_node_id`, but this R5 loading path discards its OSM-node index. Both `*_osm_identity` fields therefore report `unverified` for requested IDs and `not-requested` for coordinate requests. No result from this runner is labeled `exact-osm-node`.

| Vertex resolution                      | Meaning                                                                                                          |
| -------------------------------------- | ---------------------------------------------------------------------------------------------------------------- |
| `coordinate`                           | The case requests coordinate linking, without an OSM node identity.                                              |
| `unique-coordinate-vertex`             | Exactly one retained R5 vertex has the exported coordinate. This does not prove the requested OSM node identity. |
| `coordinate-fallback-no-vertex`        | No retained vertex has that coordinate; coordinate-to-edge linking may still find a route.                       |
| `coordinate-fallback-ambiguous-vertex` | Multiple retained vertices share the coordinate; no vertex is selected by guessing.                              |
| `unresolved-coordinate`                | Coordinates are missing or invalid, so linking cannot be evaluated.                                              |

The `*_coordinate_vertex_matches` columns give the match count when a requested-node coordinate was scanned; blank means no scan was requested or coordinates were unavailable, rather than zero matches. `coordinate_vertex_*` results are populated only when both requested node endpoints resolve to unique coordinate vertices. They remain coordinate-based observations, separate from the primary coordinate-linked route used for assertions. Ambiguous, missing, and collapsed shape-node cases cannot be promoted to verified OSM node identities.

## 3. Review the oracle matrix

Osmix reports endpoint `resolution` as `osm-node-id` when the requested ID was looked up directly, or `nearest-routable-node` when a coordinate was snapped. An unresolved endpoint stays explicit in the manifest's `from_osmix_resolution`/`to_osmix_resolution` fields. The requested IDs and `*_osmix_resolved_node_id` values are separate evidence; do not interpret a snapped node as proof of a different requested identity.

Osmix `verification.kind` distinguishes `asserted-route` from `policy-diagnostic`. Each check records its name, `passed`/`failed`/`unavailable`/`not-applicable` outcome, and whether it is a route assertion. Declared route checks inspect the Dijkstra result for reachability, metric bounds, required or forbidden OSM way IDs, and forbidden `(fromWayId, viaNodeId, toWayId)` transitions using route edges with stable OSM IDs. A* is compared separately for reachability and cost agreement; its complete path trace is not independently checked against those expectations.

If either Osmix endpoint is unresolved, declared reachability, metric, way, and transition checks are `unavailable`, including a declaration that the route should be unreachable. Missing input resolution does not prove disconnection. A required-endpoint prerequisite can still fail the case. When unresolved endpoints prevent either algorithm from running, `algorithmAgreement` is `null` and its general check is `not-applicable`. With both endpoints resolved, a computed unreachable result can pass an unreachable expectation; forbidden-way/transition checks on that absent route remain `not-applicable`.

A policy limitation does not suppress an explicitly declared expectation. Overall Osmix status can be `passed`, `failed`, `diagnostic-only`, `unavailable`, or `not-applicable`, with failed checks taking precedence over unavailable checks. A case with only unavailable or inapplicable route checks is not a passed route case. Verification summaries count actual passed route checks separately from diagnostic/general checks and expose `unavailableCases` and `unavailableRouteChecks`.

R5 reads only the separate `r5_expected_reachable`, `r5_forbidden_way_ids`, and `r5_forbidden_way_transitions` expectations. Osmix's node-route reachability and metric bounds are not automatically applied to R5's coordinate-linked route. R5 emits `coordinate_route_edges` with OSM way IDs, traversed segment distances, and full edge endpoint coordinates; `coordinate_route_transitions` adds way pairs and via coordinates. The via coordinates still have unverified OSM node identity. `coordinate_vertex_route_edges` supplies evidence for the optional coordinate-selected vertex route.

Every R5 `assertion_basis` is `coordinate-linked-route`. The supported checks are declared reachability, forbidden-way exclusion, and `whole-way-pair-exclusion`. Way exclusion checks positive-distance traversal, so a zero-distance endpoint link does not count as traveling on that way. A whole-way-pair check compares adjacent runs with positive distance on both ways; zero-length fragments of the same way remain part of its run, while an intervening different way is not removed to invent adjacency. It forbids that pair anywhere on this route, without verifying a restriction's via-node identity or implementing a complete restriction-relation check.

R5 `assertion_checks` records each check's kind, status, and evidence. A check is `unavailable` when endpoints cannot link; a forbidden-way/pair check is `not-applicable` when there is no route to inspect. Overall `assertion_status` is `diagnostic-only` when no checks were requested, `failed` if any check failed, `unavailable` if any remaining check was unavailable, `passed` if at least one check passed, and otherwise `not-applicable`. Inapplicable checks do not count as passed. Failed checks write their evidence and make the process exit nonzero. A successful process exit can still contain diagnostic-only, unavailable, or inapplicable rows; report the counts and limitations instead of calling the whole matrix passed.

Compare the declared checks and their route evidence across raw, merged, patched, and reloaded datasets. A difference requires investigation of the input changes, endpoint resolution, and graph behavior; it does not by itself prove a merge defect. R5 and Osmix measurements can differ because their linking, speed, and policy models differ. Agreement between Dijkstra and A* checks the chosen cost calculation, not a routing profile's completeness.

For policy diagnostics, inspect the limitation and witness separately from any evaluated assertion. Reachability, a longer distance, or a visually plausible detour does not prove avoidance of a forbidden way or transition. That claim requires explicit path evidence and a corresponding passing check. Do not count a diagnostic witness as a passed access or restriction assertion, or promote current limited-policy behavior into a routing golden.

## Verification run: 2026-09-14

The focused Osmix routing suites passed 25 tests, including 16 new verification regressions. Raw, merged, and PBF-reloaded fixtures exercise the test-only access-aware detour, stable node/way/transition evidence, diagnostic classification, deliberately failing reachability/way/transition expectations, inapplicable exclusions, coincident node identities, and missing-endpoint exports. They distinguish a computed unreachable route with resolved endpoints from unavailable route checks caused by missing endpoints. These are automated fixture assertions, not a claim that the default router implements every access or restriction rule.

The optional local R5 run used checkout `6f3554291d6eef41469610224b4f8a3ee36e7276`, Java 21.0.9, and Gradle 9.3.0. That checkout contained a preexisting generated `src/main/java/geobuf/Geobuf.java` builder-construction change, included in the fresh compilation; no R5 routing source was modified for this run. Its 16 self-test scenarios passed, including coordinate ambiguity, unverified requested IDs, unavailable endpoints, deliberate assertion failures, and zero-distance endpoint evidence. The generated matrices produced these results:

| Matrix             | Datasets | Passed checks | Diagnostic-only rows | Checks evaluated                                                                                                                            |
| ------------------ | -------: | ------------: | -------------------: | ------------------------------------------------------------------------------------------------------------------------------------------- |
| Monaco             |        5 |            10 |                   60 | Per dataset: exclude positive-distance traversal of way `158215187`; exclude adjacent positive-distance way runs `176527122` → `166399477`. |
| Property copying   |        3 |             3 |                    3 | Per dataset: the coordinate-linked WALK route remains unreachable. CAR remains diagnostic.                                                  |
| Network attachment |        2 |             2 |                    2 | Per dataset: the coordinate-linked WALK route is reachable. CAR remains diagnostic.                                                         |

In total, 15 declared checks passed and 65 rows remained diagnostic-only. None of the declared checks failed or was unavailable/inapplicable. The outside-Monaco diagnostic still had unlinked endpoints and no requested R5 assertion; that row is not a passed reachability check. Requested OSM node identities remained unverified in every R5 result, including unique coordinate matches. Coincident ambiguity and missing coordinates were exercised by the focused regression/self-test cases.

TSV outputs were byte-identical within each matrix's variants. A separate negative run deliberately forbade observed, positive-distance way `157719644` on the raw Monaco route: it wrote one failed check and exited with status 1. This demonstrates failure propagation as well as successful checks. No current R5 result verifies a restriction's via-node identity or establishes complete modal legality.

## Historical Monaco observations

Earlier notes record a 2026-07-21 run against local R5 commit `ac95649c7094bf394b3be43fa523d0fb4447633e` with unrelated existing local changes, and byte-identical TSVs for the five Monaco variants. The previous runner did not verify the manifest's OSM node IDs or assert access/restriction path legality. Its former “exact-vertex” column was selected by a unique coordinate match; it is relabeled below. These values are historical observations, not current assertion results or a CI golden.

| Case                                | Mode | Coordinate distance | Duration | Coordinate-selected vertex result |
| ----------------------------------- | ---- | ------------------: | -------: | --------------------------------- |
| `monaco-short-drive`                | CAR  |           254.162 m |     19 s | n/a                               |
| `monaco-short-walk`                 | WALK |           254.162 m |    196 s | n/a                               |
| `monaco-cross-town-drive`           | CAR  |         5,690.595 m |  1,166 s | n/a                               |
| `monaco-streets-and-steps-walk`     | WALK |           459.287 m |    359 s | n/a                               |
| `monaco-oneway-forward`             | CAR  |            48.672 m |     46 s | 34.200 m / 4 s                    |
| `monaco-oneway-reverse`             | CAR  |           737.016 m |    204 s | 124.167 m / 103 s                 |
| `monaco-reverse-oneway-legal`       | CAR  |            12.456 m |     99 s | n/a                               |
| `monaco-reverse-oneway-detour`      | CAR  |            23.473 m |    108 s | n/a                               |
| `monaco-implicit-roundabout-oneway` | CAR  |            73.007 m |    123 s | n/a                               |
| `monaco-motor-vehicle-access`       | CAR  |           215.600 m |     50 s | unreachable                       |
| `monaco-no-left-turn-restriction`   | CAR  |           490.496 m |    277 s | 288.450 m / 134 s                 |
| `monaco-tunnel-layer-regression`    | CAR  |            21.771 m |    106 s | n/a                               |
| `monaco-reachability-regression`    | CAR  |             7.148 m |     95 s | n/a                               |

The last two cases assert Osmix node-to-node topology. The earlier R5 run had no retained coordinate vertex for one endpoint in each case; coordinate linking could choose a nearby level. Its distances cannot be substituted for the Osmix node-ID expectations. Raw/merged equality here records stability of those coordinate-linked observations, not verified endpoint identity or route legality.

## Historical synthetic conflation observations

The same 2026-07-21 R5 checkout was recorded for the explicit 1-meter conflation variants. The
ordinary fixture contains two aligned footway components whose endpoints are about 0.56 meters
apart. Property transfer changes only a selected `name`; network attachment rewrites the first
imported way reference to the preserved base endpoint.

| Variant                             | WALK reachable | Coordinate result | Coordinate-selected vertex result |
| ----------------------------------- | -------------- | ----------------: | --------------------------------: |
| ordinary direct merge               | no             |               n/a |                               n/a |
| property transfer                   | no             |               n/a |                               n/a |
| property transfer after PBF reload  | no             |               n/a |                               n/a |
| network attachment                  | yes            | 222.244 m / 237 s |                 222.245 m / 240 s |
| network attachment after PBF reload | yes            | 222.244 m / 237 s |                 222.245 m / 240 s |

Earlier notes record byte-identical property-side TSVs and byte-identical attachment-side TSVs. Osmix separately asserts that attachment changes WALK from two components to one while its CAR graph is unchanged. The recorded `osmium check-refs` result was zero missing way-node references for these PBFs; reference integrity is a separate check from route legality. The previous R5 runner did not assert OSM node identity or path restrictions for these observations.
