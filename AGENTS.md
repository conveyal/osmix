# Repository Guidelines

## Architecture Overview
- End-to-end merges run entirely in the browser: Comlink Web Workers host `@osmix/core`, `@osmix/change`, and raster generation so the React UI stays responsive.
- Typed arrays, string tables, and transferable buffers keep multi-hundred-megabyte PBF extracts efficient across Bun, Node 20+, and modern browsers.
- Streaming transforms in `@osmix/pbf` and `@osmix/json` let the same code paths ingest PBF bytes from buffers, generators, or Web Streams without full materialization.
- OffscreenCanvas tiles from `@osmix/raster` and deck.gl overlays provide visual context while MapLibre handles basemap rendering and a custom raster protocol.

## Stack Snapshot
- Bun 1.3 orchestrates the monorepo via workspaces and shared scripts (`package.json`).
- TypeScript with ES modules everywhere; Vitest for tests; Biome (`bun run check`) for format + lint + organize imports.
- React 19 + Vite drive `apps/merge`; Jotai manages UI state; MapLibre + deck.gl render spatial layers; native-file-system-adapter provides File System Access fallbacks.
- Compression Streams, KDBush, Flatbush, and transfer-friendly typed arrays underpin performance-sensitive code paths.

## Project Structure & Module Organization
- Root `package.json` defines workspace filters (`bun run --filter '*' ...`) and cataloged versions for shared dependencies.
- `apps/merge` is the Vite/React front-end; heavy work stays in `apps/merge/src/workers/osm.worker.ts` which wraps `OsmixWorker`.
- `packages/core` hosts the in-memory `Osmix` engine, entity stores (`nodes.ts`, `ways.ts`, `relations.ts`), typed-array utilities, and transferables.
- `packages/change` exposes `OsmixChangeset`, merge helpers, and deduplication/intersection workflows.
- `packages/json` bridges PBF blocks to JSON entities and GeoJSON helpers (`OsmPbfBlockParser`, `blocksToJsonEntities`, `wayToFeature`).
- `packages/pbf` mirrors the protobuf spec, providing `readOsmPbf`, transform streams, and generated codecs under `packages/pbf/src/proto`.
- `packages/raster` renders `Osmix` indexes into PNG tiles (`OsmixRasterTile`) and registers the `@osmix/raster` MapLibre protocol.
- `packages/test-utils` supplies shared Vitest fixtures and helpers; tests live alongside sources as `*.test.ts`.
- `fixtures/` stores gzipped reference extracts for integration tests and demos.

## Data Flow & Worker Patterns
- `@osmix/pbf` decodes raw PBF bytes into `OsmPbfBlock`s, `@osmix/json` upgrades them to entities/GeoJSON, and `@osmix/core` indexes them in `Osmix`.
- `Osmix.transferables()` returns structured buffers; workers reconstruct via `Osmix.from` to avoid structured cloning overhead.
- Raster requests from MapLibre hit the custom protocol, which calls the worker’s `getTileImage` and streams back OffscreenCanvas-encoded buffers.
- Changesets originate in the worker: `OsmixChangeset` deduplicates nodes/ways, generates direct merges, applies changes, and streams paginated results to the UI.

## Common Gotchas
- `Nodes.addDenseNodes` only accepts dense encodings; malformed blocks raise early errors.
- After applying change sets, always rebuild indexes (`Osmix.buildIndexes`) before running spatial queries.
- MapLibre protocol URLs encode `<osmId>/<tileSize>/<z>/<x>/<y>.png`; mismatched parsing leads to silent 404-like map errors.
- Worker logging should use the throttled logger (`createThrottledLog`) to avoid overwhelming the UI thread.

## Build, Test, and Development Commands
- `bun install` boots the workspace using Bun’s package manager.
- `bun run dev` starts all workspace apps in watch mode (for example, `bun run --filter @osmix/merge dev`).
- `bun run build` executes production builds across packages and apps.
- `bun run test` runs Vitest suites in every package.
- `bun run typecheck` runs `tsc --noEmit` per package to guard against regressions.
- `bun run lint` (Biome) enforces lint rules; `bun run format` rewrites style issues; `bun run check` combines format, lint, and organize-imports.

## Coding Style & Naming Conventions
- TypeScript everywhere; prefer explicit exports from package entrypoints and ES module syntax.
- Indent with tabs; keep lines under 100 characters when feasible, and avoid manual Markdown line wrapping unless required.
- Stick to the `@osmix/<package>` naming convention for workspace modules.
- Always run `bun run format`, `bun run typecheck`, and `bun run test` before considering a task complete.

## Testing Guidelines
- Use Vitest (`describe`/`it`) and helpers from `@osmix/test-utils` for deterministic expectations.
- Name test files `<feature>.test.ts` and mirror the directory structure of the code under test.
- Prefer lightweight fixtures; large PBF fixtures belong in `fixtures/` and should be gzipped. Use `fixtures/monaco.pbf` in tests and references in READMEs.
- Cover new OSM entity transformations with serialization and round-trip parsing tests.

## Commit & Pull Request Guidelines
- Follow concise, imperative subject lines (e.g., `Rename osm-merge -> @osmix/merge`).
- Reference related issues in the body and note behavioral impacts or migration steps.
- Summarize scope, list verification commands, and include UI screenshots or GIFs for `apps/merge` changes.
- Coordinate cross-package changes by linking dependent PRs and documenting workspace version bumps when relevant.
