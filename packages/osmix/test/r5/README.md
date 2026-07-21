# Local R5 routing oracle

R5 is the authority for Conveyal street-mode legality. This local-only runner sends the exact
Monaco endpoints used by the Osmix regression suite through `TransportNetwork.fromFiles`,
`StreetRouter`, and `StreetMode.CAR` or `StreetMode.WALK`. It does not add R5 to Osmix's CI or
package dependency graph.

The checked-in Osmix expectations cover topology, route shape, broad measurements, and
Dijkstra/A* agreement. Two cases are intentionally policy diagnostics rather than absolute
Osmix goldens:

- `monaco-motor-vehicle-access`: R5 must not drive on `motor_vehicle=no` way `158215187`.
- `monaco-no-left-turn-restriction`: R5 must honor `no_left_turn` relation `4261963`.

The implicit-roundabout and reverse-oneway cases are absolute goldens: Osmix and R5 both take the
legal direction implied by `junction=roundabout` and `oneway=-1`.

The test-only Osmix WALK graph changes highway eligibility and speeds, but the generic
`RoutingGraph` still applies way-level `oneway` and roundabout direction. No accepted Monaco walk
case depends on that limitation; R5 WALK results remain authoritative for modal legality.

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

- `routing-cases.tsv`: modes, OSM node IDs, and exact snapped coordinates for R5.
- Raw, empty-merged, synthetic-patched, and reloaded Monaco PBFs: exact oracle inputs.
- `oracle-matrix.json`: current Osmix raw, merged, and PBF-reloaded reports.
- Per-dataset JSON and GeoJSON diagnostics for visual review.
- `synthetic/`: generated merged and PBF-reloaded synthetic networks and reports.

Normal tests never write these files and no command auto-updates checked-in expectations.

## 2. Run the same matrix through a local R5 checkout

Run from the R5 repository. The init script adds only a temporary source set and task. Supplying a
temporary build directory keeps generated R5 build files out of the adjacent checkout.

```sh
R5_ORACLE_BUILD="$(mktemp -d /tmp/osmix-r5-build.XXXXXX)"
gradle --no-daemon --init-script \
  "$OSMIX_DIR/packages/osmix/test/r5/r5-oracle.init.gradle" \
  -PosmixOracleBuildDir="$R5_ORACLE_BUILD" \
  -PosmixOracleSourceDir="$OSMIX_DIR/packages/osmix/test/r5" \
  -PosmixOracleManifest="$ORACLE_DIR/routing-cases.tsv" \
  -PosmixOracleOutputDir="$ORACLE_DIR" \
  runOsmixRoutingOracle
```

Use `--offline` when the R5 Gradle dependencies are already cached. The runner produces
one TSV per Monaco dataset in `ORACLE_DIR`.

The primary result columns use normal R5 coordinate-to-edge linking. For node-ID cases, the runner
also reports an exact-vertex result when both OSM nodes survive as unambiguous R5 topological
vertices. R5 collapses intermediate shape nodes, so the endpoint-resolution columns record
`coordinate-fallback-no-vertex` when no exact vertex exists. Exact-vertex results are left blank
rather than guessed when either endpoint is missing or more than one R5 vertex has that coordinate.

## 3. Review the oracle matrix

For absolute-golden cases, raw, merged, patched, and reloaded R5 reachability and measurements
should agree; any difference indicates a merge or serialization defect. R5 and Osmix measurements
can differ because their snapping, speed, and policy models are different, so compare reachability,
direction, and plausible bounded metrics rather than exact equality.

For the two policy diagnostics, inspect the expectation in the last column of
`routing-cases.tsv`. A reachable result alone is insufficient: compare its distance with the
Osmix route in `oracle-matrix.json` and inspect the matching GeoJSON when necessary to confirm R5
used the legal detour. Do not promote current Osmix behavior for these cases into a golden unless
the missing policy is implemented.

## Observed Monaco matrix

The runner was verified on 2026-07-21 with a local R5 checkout at commit
`ac95649c7094bf394b3be43fa523d0fb4447633e` (with unrelated existing local changes). All five raw,
empty-merged, synthetic-patched, and reloaded TSV outputs were byte-for-byte identical. These
values document that run; they are not a CI golden because R5 remains a local oracle.

| Case                                | Mode | Coordinate distance | Duration | Exact-vertex result |
| ----------------------------------- | ---- | ------------------: | -------: | ------------------- |
| `monaco-short-drive`                | CAR  |           254.162 m |     19 s | n/a                 |
| `monaco-short-walk`                 | WALK |           254.162 m |    196 s | n/a                 |
| `monaco-cross-town-drive`           | CAR  |         5,690.595 m |  1,166 s | n/a                 |
| `monaco-streets-and-steps-walk`     | WALK |           459.287 m |    359 s | n/a                 |
| `monaco-oneway-forward`             | CAR  |            48.672 m |     46 s | 34.200 m / 4 s      |
| `monaco-oneway-reverse`             | CAR  |           737.016 m |    204 s | 124.167 m / 103 s   |
| `monaco-reverse-oneway-legal`       | CAR  |            12.456 m |     99 s | n/a                 |
| `monaco-reverse-oneway-detour`      | CAR  |            23.473 m |    108 s | n/a                 |
| `monaco-implicit-roundabout-oneway` | CAR  |            73.007 m |    123 s | n/a                 |
| `monaco-motor-vehicle-access`       | CAR  |           215.600 m |     50 s | unreachable         |
| `monaco-no-left-turn-restriction`   | CAR  |           490.496 m |    277 s | 288.450 m / 134 s   |
| `monaco-tunnel-layer-regression`    | CAR  |            21.771 m |    106 s | n/a                 |
| `monaco-reachability-regression`    | CAR  |             7.148 m |     95 s | n/a                 |

The last two cases deliberately assert Osmix node-to-node topology. R5 collapses one endpoint in
each case into an intermediate shape point, then normal coordinate linking can snap to a different
nearby level. Their R5 distance is therefore not compared with the Osmix node-ID golden; raw versus
merged equality remains the valid R5 check for those witnesses.
