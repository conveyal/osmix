# Osmix Guide

## Run These Every Change

- For each changed package/app (and packages/apps that depend on the changed code): `pnpm run format`, `pnpm run lint`, `pnpm run typecheck`, and `pnpm run test` must be green.
- Add or extend tests and documentation when behavior or public APIs change.
- Only run root tests before committing.
- `pnpm run check:deps` validates workspace import/dependency alignment.

## Testing Notes

- Vitest with tests as `*.test.ts`.
- Fixtures: prefer `fixtures/monaco.pbf` via `@osmix/test-utils/fixtures` (devDependency in tests).
- Cover parsing, serialization, spatial queries, merge workflows, and regressions.

## Package Layout

Layering (low → high):

`@osmix/types` + `@osmix/geo` + `@osmix/shared` → `@osmix/pbf` + `@osmix/json` → `@osmix/load` → `@osmix/core` → converters (`geojson`, `geoparquet`, `gtfs`, `shapefile`, `change`, `router`, `vt`, `shortbread`, `raster`) → `osmix` facade → apps.

| Package                                                | Role                                                                         |
| ------------------------------------------------------ | ---------------------------------------------------------------------------- |
| `@osmix/types`                                         | OSM domain types, type guards, relation-kind, zigzag                         |
| `@osmix/geo`                                           | Tile math, haversine, bbox, lineclip, multipolygon helpers                   |
| `@osmix/shared`                                        | Generic plumbing (streams, assert, progress) + tsconfig presets              |
| `@osmix/test-utils`                                    | Test fixtures (`monaco.pbf`, etc.) — devDependency only                      |
| `@osmix/pbf`                                           | Low-level OSM PBF parse/write (leaf; no workspace runtime deps)              |
| `@osmix/json`                                          | PBF blocks ↔ JSON entities                                                   |
| `@osmix/load`                                          | PBF streams → `Osm` indexes; extract and export                              |
| `@osmix/core`                                          | In-memory `Osm` with spatial indexes; `OsmReader`/`OsmWriter` contracts      |
| `@osmix/change`                                        | Changesets, dedup, merge                                                     |
| `@osmix/geojson` / `geoparquet` / `gtfs` / `shapefile` | Alternate import/export formats                                              |
| `@osmix/raster` / `@osmix/vt` / `@osmix/shortbread`    | Tile encoders                                                                |
| `@osmix/router`                                        | Routing graph and pathfinding                                                |
| `osmix`                                                | Curated facade + worker/Comlink orchestration (`OsmixRemote`, `OsmixWorker`) |

**App import rule:** apps import `osmix` for runtime APIs and re-exported types. Use granular `@osmix/*` packages only when a symbol is not exposed by the facade (e.g. benchmarks, servers, or tests).

Test mocks: `@osmix/core/mocks` (not re-exported from the main `@osmix/core` entry).

## Architecture in Brief

- In-browser merge: Comlink workers host `osmix` (`OsmixWorker`) to keep the React UI responsive.
- `@osmix/pbf` + `@osmix/json` stream PBF blocks to entities; `@osmix/load` builds `Osm` indexes from PBF; `@osmix/core` indexes and ships transferables to dodge clone costs.
- MapLibre uses a custom raster protocol and renders vector overlays for node/way previews.

## Key Paths

- UI: `apps/merge` (React 19 + Vite); worker wrapper at `apps/merge/src/workers/osm.worker.ts`.
- Merge app design conventions: `apps/merge/DESIGN.md` — read before UI changes.
- Worker API: `packages/osmix/src/worker.ts`, `packages/osmix/src/remote.ts`.
- Fixtures: `fixtures/` at repo root; loaded via `@osmix/test-utils/fixtures`.

## Commands

- `pnpm install` to bootstrap; `pnpm run dev` (filterable) for local dev; `pnpm run build` for production bundles.
- `pnpm run check` runs `oxfmt` then type-aware `oxlint` in one pass.
- `pnpm run format:check` and `pnpm run lint:check` run non-mutating formatting and lint checks.
- `pnpm run check:deps` flags undeclared or unused workspace dependencies.
- `pnpm run test:verify-workspace` tests the workspace selector and required-script checks.
- `pnpm run verify:workspace -- @osmix/core` verifies a workspace and its runtime/development dependents in dependency order.
- `pnpm run verify:workspace -- apps/vt-server` accepts an app path selector and verifies that app's runtime graph.
- `pnpm run verify:all` verifies every non-benchmark workspace, then runs dependency and Node smoke checks.

`verify:workspace` is check-only by default. Pass `--write` when an explicit formatting write is intended. The benchmark app is excluded from the all-workspace contract because its browser benchmark is not a package test; select it explicitly when working on that app.

## Gotchas

- `Nodes.addDenseNodes` only accepts dense encodings; malformed blocks fail fast.
- Call `buildIndexes()` after changes before spatial queries.
- MapLibre raster URLs: `<osmId>/<tileSize>/<z>/<x>/<y>.png`.
- Use throttled logging when streaming worker progress.
- `@osmix/pbf` must stay dependency-free at runtime (helpers inlined; test helpers in `test/helpers`).

## Style

- TypeScript + ES modules; named exports over default; kebab-case files; packages as `@osmix/<package>`.
- Tabs in code; keep TS/CSS/code blocks under ~100 characters; avoid manual wrapping of prose.
- Annotate public APIs; avoid `any`/unsafe casts; prefer early returns.
- React: keep components small, offload heavy work to workers, use keys/memoization pragmatically.

## PR and Commit Hygiene

- PRs: formatted, linted, typed, and tested; imports organized; include UI note/screenshot for app changes; call out cross-package impacts.
- Commits: imperative subject; body explains why/what, behavior shifts, and verification commands; reference related issues.
