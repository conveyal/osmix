# Osmix Guide

## Run These Every Change

- While working: `pnpm run fix` to format and apply safe lint fixes, and `pnpm exec vitest run --changed origin/main` (or `--project @osmix/<name>`) for the tests your change touches.
- Before committing: `pnpm run verify` (check, change intents, knip and every test project) must be green.
- Add or extend tests and documentation when behavior or public APIs change.
- When a change affects a published package, record a change intent: `pnpm change <packages> --bump <patch|minor|major> --summary "..."` (`--bump none` if no release is needed). The summary becomes the CHANGELOG entry. See "Releasing" in `README.md`.
- Before changing merge rules, matching actions, or merge workflow states, read [docs/merge-process.md](docs/merge-process.md). Update its affected rules/examples and linked regression tests in the same PR.
- `pnpm run knip` flags unused files, exports, and dependencies, and imports missing from `package.json`. Configure false positives (non-standard entry points) in `knip.json`; do not keep dead exports.

## Testing Notes

- Vitest with tests as `*.test.ts`. One root `vitest.config.ts` lists every project: `packages/*`, `apps/app`, the two servers, and `scripts`. Packages have no `test` scripts; run vitest from the root. `apps/bench` runs in a browser and only through `pnpm -F @osmix/bench test`.
- `scripts/check-docs.test.ts` compiles the `check-docs` code blocks in the READMEs and `docs/merge-process.md`.
- Fixtures: prefer `fixtures/monaco.pbf` via `@osmix/test-utils/fixtures` (devDependency in tests).
- Cover parsing, serialization, spatial queries, merge workflows, and regressions.

## Package Layout

Layering (low → high):

`@osmix/types` + `@osmix/geo` + `@osmix/shared` → `@osmix/pbf` + `@osmix/json` → `@osmix/load` → `@osmix/core` → converters (`geojson`, `geoparquet`, `gtfs`, `shapefile`, `change`, `router`, `vt`, `shortbread`, `raster`; `change` uses `router` for routing topology) → `osmix` facade → apps and `@osmix/cli`.

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
| `@osmix/change`                                        | Merge plans (planner, overlay, rulebook), within-dataset dedup, `merge()`    |
| `@osmix/geojson` / `geoparquet` / `gtfs` / `shapefile` | Alternate import/export formats                                              |
| `@osmix/raster` / `@osmix/vt` / `@osmix/shortbread`    | Tile encoders                                                                |
| `@osmix/router`                                        | Routing graph and pathfinding                                                |
| `osmix`                                                | Curated facade + worker/Comlink orchestration (`OsmixRemote`, `OsmixWorker`) |
| `@osmix/ui`                                            | Private: shared React primitives, layout shell, design tokens (`styles.css`) |
| `@osmix/app-core`                                      | Private: app worker/remote, IndexedDB storage, jotai atoms, `useOsmFile`     |
| `@osmix/app-components`                                | Private: MapLibre integration and OSM domain components shared by the apps   |
| `@osmix/cli`                                           | `osmix` command: terminal map viewer for OSM PBF files                       |

**App import rule:** apps import `osmix` for runtime APIs and re-exported types, plus the private app-tier packages (`@osmix/ui`, `@osmix/app-core`, `@osmix/app-components`). Use other granular `@osmix/*` packages only when a symbol is not exposed by the facade (e.g. benchmarks, servers, or tests).

Test mocks: `@osmix/core/mocks` (not re-exported from the main `@osmix/core` entry).

## Architecture in Brief

- In-browser merge: Comlink workers host `osmix` (`OsmixWorker`) to keep the React UI responsive.
- `@osmix/pbf` + `@osmix/json` stream PBF blocks to entities; `@osmix/load` builds `Osm` indexes from PBF; `@osmix/core` indexes and ships transferables to dodge clone costs.
- MapLibre uses custom raster and vector tile protocols (`registerOsmixProtocols(remote)` in `@osmix/app-components`) and renders vector overlays for node/way previews. Merge draws its plan from `@osmix/plan` tiles that the worker builds from the live plan, never as one GeoJSON layer. Call `installMaplibreWorker()` before the first map mounts.

## Key Paths

- UI: `apps/app` (React 19 + Vite, wouter routes): Home (`/`) and the Merge, Inspect (single-dataset viewer) and Extract (bbox extracts) pages, on one origin. The route table and the one shared `OsmixMap` are in `apps/app/src/app.tsx`; each page supplies its sidebar and what the map shows. Page state lives in jotai atoms and survives navigation. App worker at `packages/app-core/src/workers/osmix-app.worker.ts`, created with `createOsmixAppRemote()` and shared through `remoteAtom`.
- Slots: each `useOsmFile(osmKey)` slot (`base`, `patch`, `inspect`, `extract`, `extract-source`) owns a private worker dataset id (`slotOsmId`), frees it when replaced or cleared, and never shares it. Move datasets between slots with `copyStateFrom` (as "Open in" and Merge's swap do), never by reusing an id. Browser storage stays keyed by file or content hash. Use `useBaseOsm`/`usePatchOsm` for Merge's inputs, so they refuse each other's file.
- Shared UI conventions: `packages/ui/DESIGN.md` — read before UI changes; Merge-specific rules in `apps/app/DESIGN.md`. The theme is closed (only tokens produce CSS) and lint enforces call-site styling: use the primitives it lists (`AppSidebar`, `SidebarSection`, `Step`, `Alert`, `NativeSelect`, `Radio`, `ScrollArea`, `IconButton`, `Pager`, `MapPanelHeader`, `useMapColors`) instead of styling at call sites.
- The apps are desktop-only: windows 1024px and wider. Narrower windows get `SmallWindowAlert`; never add `sm:`/`md:`/`lg:`/`max-*` variants or phone layouts (`osmix/no-breakpoint-variant`). See "Supported viewports" in `packages/ui/DESIGN.md`.
- Worker API: `packages/osmix/src/worker.ts`, `packages/osmix/src/remote.ts`.
- Fixtures: `fixtures/` at repo root; loaded via `@osmix/test-utils/fixtures`.

## Commands

- `pnpm install` to bootstrap; `pnpm run dev` (filterable) for local dev; `pnpm run build` for production bundles.
- `pnpm run check` runs `oxfmt --check` and `oxlint` without changing files. `oxlint` is type-aware and runs the TypeScript checker (`typeCheck` in `.oxlintrc.json`), so there is no separate `typecheck` script. Every `.ts` file must be in some `tsconfig.json`; the root one covers `scripts/` and root configs.
- `pnpm run fix` runs `oxfmt` and `oxlint --fix`.
- `pnpm run test` runs every vitest project once.
- `pnpm run verify` runs `check`, `pnpm change check`, `knip` and `test`.
- `pnpm run knip` flags unused files, exports, and dependencies, and undeclared imports, across all workspaces.
- `pnpm run smoke` packs the published packages and imports them from a clean consumer (CI runs it on Node and Bun).

## Gotchas

- `Nodes.addDenseNodes` only accepts dense encodings; malformed blocks fail fast.
- Call `buildIndexes()` after changes before spatial queries.
- MapLibre raster URLs: `<osmId>/<tileSize>/<z>/<x>/<y>.png`, with an optional `?role=base|patch` that picks the dataset's `--map-*` color.
- Use throttled logging when streaming worker progress.
- `@osmix/pbf` must stay dependency-free at runtime (helpers inlined; test helpers in `test/helpers`).
- App work runs as `Tasks` (`@osmix/app-core`): one top-level task at a time (`TaskAlreadyRunningError` otherwise). A caller that wraps a hook which starts its own task (the load hooks do) must not start a second one around it.

## Style

- TypeScript + ES modules; named exports over default; kebab-case files; packages as `@osmix/<package>`.
- Tabs in code; keep TS/CSS/code blocks under ~100 characters; avoid manual wrapping of prose.
- Annotate public APIs; avoid `any`/unsafe casts; prefer early returns.
- React: keep components small, offload heavy work to workers, use keys/memoization pragmatically.

## PR and Commit Hygiene

- PRs: formatted, linted, typed, and tested; imports organized; include UI note/screenshot for app changes; call out cross-package impacts.
- Commits: imperative subject; body explains why/what, behavior shifts, and verification commands; reference related issues.
