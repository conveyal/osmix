# Osmix Guide

## Run These Every Change
- `bun run format`, `bun run lint`, `bun run typecheck`, and `bun run test` must be green.
- Add or extend tests and documentation when behavior or public APIs change.

## Testing Notes
- Bun + Vitest with helpers in `@osmix/test-utils`; tests live as `*.test.ts`.
- Fixtures: prefer `fixtures/monaco.pbf` or synthetic data.
- Cover parsing, serialization, spatial queries, merge workflows, and regressions.

## Architecture in Brief
- In-browser merge: Comlink workers host `@osmix/core`, `@osmix/change`, and `@osmix/raster` to keep the React UI responsive.
- `@osmix/pbf` + `@osmix/json` stream PBF blocks to entities; `@osmix/core` indexes and ships transferables to dodge clone costs.
- MapLibre uses a custom raster protocol and renders vector overlays for node/way previews.

## Key Paths
- UI: `apps/merge` (React 19 + Vite); worker wrapper at `apps/merge/src/workers/osm.worker.ts`.
- Packages: `core`, `change`, `json`, `pbf`, `raster`, `test-utils`; shared fixtures in `fixtures/`.

## Commands
- `bun install` to bootstrap; `bun run dev` (filterable) for local dev; `bun run build` for production bundles.
- `bun run check` runs format/lint/import organization in one pass.

## Gotchas
- `Nodes.addDenseNodes` only accepts dense encodings; malformed blocks fail fast.
- Call `Osmix.buildIndexes` after changes before spatial queries.
- MapLibre raster URLs: `<osmId>/<tileSize>/<z>/<x>/<y>.png`.
- Use throttled logging when streaming worker progress.

## Style
- TypeScript + ES modules; named exports over default; kebab-case files; packages as `@osmix/<package>`.
- Tabs in code; keep TS/CSS/code blocks under ~100 characters; avoid manual wrapping of prose.
- Annotate public APIs; avoid `any`/unsafe casts; prefer early returns.
- React: keep components small, offload heavy work to workers, use keys/memoization pragmatically.

## PR and Commit Hygiene
- PRs: formatted, linted, typed, and tested; imports organized; include UI note/screenshot for app changes; call out cross-package impacts.
- Commits: imperative subject; body explains why/what, behavior shifts, and verification commands; reference related issues.
