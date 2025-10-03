# Repository Guidelines

## Project Structure & Module Organization
- Root `package.json` defines a Bun workspace with shared scripts and dependency catalog.
- Application code lives in `apps/merge`, a Vite front-end that wraps the core OSM tooling.
- Reusable libraries sit under `packages/`: `core` (PBF reader/writer/merge engine), `json`, `pbf`, and `test-utils`.
- Tests co-locate with source packages (for example `packages/core/test`) and ship as `.test.ts` files using Vitest fixtures.
- Binary fixtures for integration scenarios are stored in `fixtures/`.

## Build, Test, and Development Commands
- `bun install` boots the workspace using Bun's package manager.
- `bun run dev` starts all workspace apps in watch mode (Vite dev server for `apps/merge`).
- `bun run build` executes the production build across packages and apps.
- `bun run test` triggers Vitest suites in every workspace package.
- `bun run typecheck` runs `tsc --noEmit` for each package to guard against type regressions.
- `bun run lint` (Biome) enforces lint rules; pair with `bun run format` to rewrite style issues.

## Coding Style & Naming Conventions
- TypeScript everywhere; prefer ES modules and explicit exports from package entrypoints.
- Indent with tabs; keep lines under 100 characters when feasible.
- Stick to the `@osmix/<package>` naming convention for workspace modules.
- Run `bun run check` (Biome combined check) before opening a PR to ensure formatting, lint, and organize-imports compliance.

## Testing Guidelines
- Use Vitest (`describe/it`) and the helpers in `@osmix/test-utils` for deterministic expectations.
- Name test files `<feature>.test.ts` and mirror the directory structure of the code under test.
- Prefer lightweight fixtures; larger PBF fixtures belong in `fixtures/` and should be gzipped.
- Aim to cover new OSM entity transformations with both serialization and round-trip parsing tests.

## Commit & Pull Request Guidelines
- Follow the existing concise, imperative subject lines (e.g., `Rename osm-merge -> @osmix/merge`).
- Reference related issues in the body and note behavioral impacts or migration steps.
- PRs should summarize scope, list verification commands, and include UI screenshots or GIFs for `apps/merge` changes.
- Coordinate cross-package changes by linking dependent PRs and noting workspace version bumps when relevant.
