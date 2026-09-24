# Osmix Guide

## Run These Every Change

- For each changed package/app (and packages/apps that depend on the changed code): `pnpm run format`, `pnpm run lint`, and `pnpm --filter <pkg> run typecheck` must be green. `pnpm run verify` runs `build`+`typecheck`+`test` across the whole repo via `pnpm pipeline` (cached — see "Commands" below); `pnpm run test` runs the whole suite directly.
- Add or extend tests and documentation when behavior or public APIs change.
- Before changing merge rules, matching actions, or merge workflow states, read [docs/merge-process.md](docs/merge-process.md). Update its affected rules/examples and linked regression tests in the same PR.
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
| `@osmix/ui`                                            | Private: shared React primitives, layout shell, design tokens (`styles.css`) |
| `@osmix/app-core`                                      | Private: app worker/remote, IndexedDB storage, jotai atoms, `useOsmFile`     |

**App import rule:** apps import `osmix` for runtime APIs and re-exported types, plus the private app-tier packages (`@osmix/ui`, `@osmix/app-core`, `@osmix/app-components`). Use other granular `@osmix/*` packages only when a symbol is not exposed by the facade (e.g. benchmarks, servers, or tests).

Test mocks: `@osmix/core/mocks` (not re-exported from the main `@osmix/core` entry).

## Architecture in Brief

- In-browser merge: Comlink workers host `osmix` (`OsmixWorker`) to keep the React UI responsive.
- `@osmix/pbf` + `@osmix/json` stream PBF blocks to entities; `@osmix/load` builds `Osm` indexes from PBF; `@osmix/core` indexes and ships transferables to dodge clone costs.
- MapLibre uses custom raster and vector tile protocols (`registerOsmixProtocols(remote)` in `@osmix/app-components`) and renders vector overlays for node/way previews. Call `installMaplibreWorker()` before the first map mounts.

## Key Paths

- UI: `apps/merge` (React 19 + Vite), `apps/inspect` (single-dataset viewer) and `apps/extract` (bbox extracts), each on its own origin and linked via `AppLinks`; app worker at `packages/app-core/src/workers/osmix-app.worker.ts`, created per app with `createOsmixAppRemote()` and shared through `remoteAtom`.
- Shared UI conventions: `packages/ui/DESIGN.md` — read before UI changes; merge-specific rules in `apps/merge/DESIGN.md`.
- Worker API: `packages/osmix/src/worker.ts`, `packages/osmix/src/remote.ts`.
- Fixtures: `fixtures/` at repo root; loaded via `@osmix/test-utils/fixtures`.

## Commands

- `pnpm install` to bootstrap; `pnpm run dev` (filterable) for local dev.
- `pnpm run check` runs `oxfmt` then type-aware `oxlint` in one pass (mutating).
- `pnpm run verify` runs `build`, `typecheck`, and `test` for every workspace via `pnpm pipeline`
  (`pipelines`/`tasks` in `pnpm-workspace.yaml`). Each task's result is cached by its declared
  `inputs`, so a repeat run only redoes work for packages whose source (or a dependency's source, via
  the task's `dependsOn`) actually changed. There is no root `build`/`typecheck` script anymore — use
  `pnpm pipeline build` / `pnpm pipeline typecheck` (or `pnpm run verify` for all three) instead.
- `pnpm run verify:all` runs `verify` plus lint, format, dependency, and docs checks (`all-root`
  pipeline), plus the Node smoke test.
- Each check has its own pipeline for running just that one, still cached, across the whole repo:
  `pnpm pipeline build`, `pnpm pipeline typecheck`, `pnpm pipeline test`. `lint:check`, `check:deps`,
  `format:check`, and `check:docs`/`test:check-docs` are root-only scripts with no per-package
  equivalent, so their pipelines need `--include-workspace-root` (e.g.
  `pnpm pipeline lint --include-workspace-root`).

`pnpm pipeline`'s `--filter`/`-F` does not scope which projects run (confirmed non-functional as of
pnpm 12.6.0), so every pipeline always runs the full graph — caching, not filtering, is what keeps
repeat runs fast. To check a single package directly (bypassing the pipeline, e.g. for a quick
iteration loop), use `pnpm --filter <pkg> run typecheck`/`test`/`build`. Don't add
`--include-workspace-root` to `build`/`typecheck`/`verify`, since including the root would also run
its own `dev`/`test` scripts as part of the same pipeline.

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
