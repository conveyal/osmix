# Repository Guidelines

Use this document as the quick orientation for anyone touching the Osmix workspace. It highlights how the tooling fits together and which habits keep the project healthy.

## Architecture Overview
- The entire merge workflow runs in-browser: Comlink workers host `@osmix/core`, `@osmix/change`, and `@osmix/raster` so the React UI stays responsive.
- Typed arrays, string tables, and transferable buffers let large PBF extracts move between worker and main threads without expensive copies.
- Streaming transforms in `@osmix/pbf` and `@osmix/json` ingest PBF bytes from buffers, generators, or Web Streams without ever materializing the full file.
- MapLibre renders the basemap via a custom raster protocol and now handles vector overlays directly for node/way previews.

## Stack Snapshot
- Bun 1.3 drives the workspace through root scripts and shared dependency versions.
- TypeScript + ES modules everywhere; Vitest for tests; Biome (`bun run check`) enforces formatting, linting, and organized imports.
- React 19 + Vite power `apps/merge`; Jotai handles UI state; native-file-system-adapter provides File System Access fallbacks.
- Compression Streams, KDBush, Flatbush, and typed-array data structures provide the performance anchors for spatial queries and indexing.

## Project Layout
- `apps/merge` contains the Vite/React front-end. Heavy lifting lives in `apps/merge/src/workers/osm.worker.ts`, which wraps `OsmixWorker`.
- `packages/core` ships the in-memory `Osmix` engine, entity stores, typed-array helpers, and transferable payload builders.
- `packages/change` exposes `OsmixChangeset` plus merge, deduplication, and intersection workflows.
- `packages/json` translates PBF blocks into JSON entities and GeoJSON helpers.
- `packages/pbf` mirrors the protobuf spec with `readOsmPbf`, transform streams, and generated codecs.
- `packages/raster` renders `Osmix` indexes into PNG tiles and registers the `@osmix/raster` MapLibre protocol.
- `packages/test-utils` hosts shared Vitest fixtures; tests live alongside sources as `*.test.ts`.
- `fixtures/` stores gzipped reference extracts for demos and integration tests.

## Worker & Data Flow
- `@osmix/pbf` decodes raw blocks, `@osmix/json` raises them to entities, and `@osmix/core` indexes them into `Osmix`.
- `Osmix.transferables()` returns structured buffers; workers rehydrate with `Osmix.from` to dodge structured-clone costs.
- Raster requests enter through the custom MapLibre protocol, call `getTileImage`, and stream back OffscreenCanvas-encoded buffers.
- Workers own changeset orchestration: `OsmixChangeset` deduplicates, generates direct merges, and streams paginated updates to the UI.

## Common Gotchas
- `Nodes.addDenseNodes` only accepts dense encodings; malformed blocks fail fast.
- Always call `Osmix.buildIndexes` after applying changes before running spatial queries.
- MapLibre protocol URLs encode `<osmId>/<tileSize>/<z>/<x>/<y>.png`; mismatched parsing looks like a mysterious 404.
- Use the throttled logger helpers when streaming worker progress to avoid locking the UI thread.

## Build, Test, and Dev Commands
- `bun install` bootstraps the monorepo.
- `bun run dev` starts all workspace apps (use filters such as `bun run --filter @osmix/merge dev`).
- `bun run build` produces production bundles across packages and apps.
- `bun run test` executes all Vitest suites.
- `bun run typecheck` runs `tsc --noEmit` for each package.
- `bun run lint` runs Biome; `bun run format` rewrites style issues; `bun run check` runs the combined format/lint/organize pass.

## Coding Style
- TypeScript everywhere; favor explicit exports from package entrypoints.
- Indent with tabs in code. Keep TypeScript/CSS/code blocks under ~100 characters, but do not manually wrap Markdown prose. `no-prose-wrap`.
- Stick to the `@osmix/<package>` naming pattern and `kebab-case` file names.
- Before finishing work, run `bun run format`, `bun run typecheck`, and `bun run test`.

## Testing Guidelines
- Use Vitest (`describe`/`it`) with helpers from `@osmix/test-utils`.
- Name tests `<feature>.test.ts` and mirror the source directory layout.
- Prefer small fixtures. Large PBFs belong in `fixtures/` and should stay gzipped (for example `monaco.pbf`).
- Cover new entity transforms with serialization and round-trip parsing tests.

## Commit & PR Guidelines
- Keep subjects concise and imperative (e.g. `Rename osm-merge -> @osmix/merge`).
- Reference related issues and call out behavior changes or migrations in the body.
- List verification commands and include UI screenshots or GIFs for `apps/merge` changes.
- Coordinate cross-package updates by linking dependent PRs and noting workspace version bumps.
