# Repository Guidelines

Use this document as the quick orientation for anyone touching the Osmix workspace. It highlights how the tooling fits together and which habits keep the project healthy.

## Definition of Done (MUST pass)
- `bun run typecheck` must pass with no errors.
- `bun run lint` must pass with no violations. Use `bun run format` to auto-fix style issues, then re-run lint.
- `bun run test` must pass and remain green across the workspace.
- If a task introduces behavior, fixes a bug, or changes public APIs, add/extend tests accordingly.

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

## Coding Style and Conventions
- TypeScript everywhere; favor explicit exports from package entrypoints.
- Indentation: use tabs in code. Keep TS/CSS/code blocks under ~100 characters. Do not manually wrap Markdown prose.
- File names: `kebab-case`. Package names follow `@osmix/<package>`.
- Imports: prefer explicit, named exports; avoid default exports for shared modules.
- Organize imports and fix style via Biome (`bun run check` or `bun run format`).

### TypeScript guidelines
- Naming: descriptive, full words. Functions are verbs; variables are nouns. Avoid 1–2 character names.
- Types: annotate function signatures and public APIs. Avoid `any` and unsafe casts.
- Control flow: use early returns; avoid deep nesting. Only use try/catch when you meaningfully handle exceptions.
- Comments: write only non-obvious rationale, invariants, or caveats. Keep comments concise.
- Formatting: match existing style; do not reformat unrelated code in edits.

### React (apps/merge)
- Keep components pure and small. Derive UI state with Jotai atoms where appropriate.
- Avoid expensive work on the main thread; move heavy processing to workers.
- Use keys and memoization pragmatically; profile before optimizing.

## Testing Requirements
- Framework: Vitest with helpers from `@osmix/test-utils`.
- Location: tests live alongside sources as `*.test.ts` mirroring directory layout.
- Fixtures: prefer small fixtures. Large PBFs belong in `fixtures/` and stay gzipped (e.g., `monaco.pbf`).
- Coverage targets: new logic should be covered by unit or integration tests where feasible, especially parsing, serialization, spatial queries, and merge workflows.

### When to add tests
- New features or public APIs.
- Bug fixes (add a regression test).
- Changes to entity transforms, serialization, or protocol parsing.
- Performance-sensitive paths where behavior must remain stable.

## PR Checklist
- Code compiles and is formatted: `bun run format` then `bun run lint`.
- Types are clean: `bun run typecheck`.
- Tests are green: `bun run test` (include new tests when warranted).
- Imports organized and unused code removed (Biome).
- For `apps/merge` changes: include a brief note or screenshot/GIF if UI-visible.
- Cross-package impacts noted; coordinate dependent PRs and version bumps when needed.

## Commit Guidelines
- Subject line: concise, imperative (e.g., `Add raster tile cache`).
- Body: why and what changed, behavior changes or migrations, verification commands.
- Reference related issues where applicable.
