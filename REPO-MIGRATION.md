# Repo Migration

Plan to split the osmix monorepo into focused repos under the `osmix-dev` GitHub org.

## Context

The monorepo mixes the published library (~19 `@osmix/*` packages) with heavy, fast-moving consumers (React/MapLibre/Tailwind apps, DuckDB bench, Node tile servers, a Bun CLI). Goals: faster/quieter CI, independent release cadence (libraries = semver, apps = continuous), keep heavy deps out of the library repo, and move experimental work off the library's surface. History check: 37/81 recent app commits and 24/31 shortbread commits also touched library packages, so the tightly coupled consumers move last.

## Decisions

| Topic                   | Decision                                                                                                                                                      |
| ----------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Consumption             | New repos depend on **published** npm versions only                                                                                                           |
| API contract            | Extracted repos import `osmix` facade + converter packages (`vt`, `shortbread`, `raster`, …); never `core`/`load`/`json`/`pbf`. Widen the facade where needed |
| `@osmix/shortbread` pkg | **Stays** in core repo; only the server app moves                                                                                                             |
| Private UI pkgs         | `ui`, `app-core`, `app-components` move to `apps`, stay private                                                                                               |
| www                     | Stays; add docs/API reference + a small standalone viewer built on `maplibre-gl` + `osmix` (no shared UI packages)                                            |
| Fixtures                | Publish `@osmix/test-utils` bundling small fixtures only                                                                                                      |
| Tooling                 | New published `@osmix/config` (tsconfig/oxlint/oxfmt presets); tsconfig presets move out of `@osmix/shared`                                                   |
| History                 | New repos start fresh (pointer commit to source SHA)                                                                                                          |
| Bench                   | Renamed `duckdb-comparison`; compares published releases only                                                                                                 |
| Apps/CLI move gate      | Owner's judgement once library churn slows                                                                                                                    |

Target repos (org `osmix-dev`):

- `osmix` — libraries, www, `@osmix/config` (transferred from `conveyal/osmix`)
- `duckdb-comparison` — from `apps/bench`, private
- `tiles` — `apps/shortbread` (shortbread-server) + `apps/vt-server`, private
- `cli` — `packages/cli`, publishes `@osmix/cli` + Bun executables
- `apps` — merge/inspect/extract + ui/app-core/app-components, private, Vercel deploys

## Phase 0 — Prepare the core repo

1. **Release pending changesets** (24) via the existing `release.yml` flow to set a version baseline.
2. **Transfer** `conveyal/osmix` → `osmix-dev/osmix`: update every `repository.url` in `packages/*/package.json`, reconfigure npm trusted publishing (OIDC) per `@osmix/*` package, reconnect Vercel Git integration for `apps/www` (and the three apps until they move). Changeset + release so npm metadata points at the new home.
3. **`@osmix/config`** (new `packages/config`): move tsconfig presets out of `@osmix/shared`; add oxlint + oxfmt presets from the root configs; root and all workspaces consume it. Changeset (`@osmix/shared` minor for removed presets).
4. **`@osmix/test-utils`**: add a `files` field shipping `monaco.*`, `monaco-gtfs.zip`, `yakima-osw` fixtures inside the package; resolve paths relative to the package (not repo root) in `packages/test-utils/src/fixtures.ts`. Keep large fixtures repo-local.
5. **Facade audit**: for each workspace being extracted, list imports of `@osmix/core|load|json|pbf`; re-export what's needed from `packages/osmix/src/index.ts` (e.g. what `apps/vt-server` and `apps/shortbread` pull from `pbf`/`json`/`core`). Publish.

## Phase 1 — `duckdb-comparison` (from `apps/bench`)

- Copy `apps/bench` into the new repo; replace `workspace:*`/`catalog:` with published versions; consume `@osmix/config`.
- Core cleanup: delete `apps/bench`; trim unused catalog entries; update AGENTS.md (layout, commands note about benchmark exclusion).

## Phase 2 — `tiles` (shortbread-server + vt-server)

- Move `apps/shortbread` and `apps/vt-server`; rewrite granular imports to facade + `@osmix/vt`/`@osmix/shortbread`.
- New repo: pnpm workspace, `@osmix/config`, CI (format/lint/typecheck/test + server boot smoke), fixtures via `@osmix/test-utils`.
- Core cleanup: remove workspaces, AGENTS.md key-paths/commands (`verify:workspace -- apps/vt-server` example).

## Phase 3 — gated (owner's call): `cli` then `apps`

**cli**

- Move `packages/cli`; depends on published `osmix` + `@osmix/shortbread`.
- Port Changesets config, a copy of `scripts/release.ts`, `release.yml` CLI executable steps (`packages/cli/scripts/release-executables.ts`), `ci.yml` `cli-executable` job. Set up OIDC trusted publishing for `@osmix/cli` from the new repo.
- Core: remove `cli` workspace and its CI/release steps. Deprecate nothing on npm — same package name continues from new repo.

**apps**

- Move `apps/app` (and the redirect-only `apps/merge`, `apps/inspect`, `apps/extract`) + `packages/{ui,app-core,app-components}` with `packages/ui/DESIGN.md`, `apps/app/DESIGN.md`, Playwright e2e, portless setup, `vercel.json`s.
- Re-point the app's Vercel project (and the three redirect projects, while they exist) to the new repo (root directories unchanged relative to repo root).
- Split AGENTS.md: UI/app sections move to the apps repo; `docs/merge-process.md` stays in core (it governs `@osmix/change`), apps repo links to it.
- Core cleanup: remove Tailwind/React/Playwright/`oxlint-tailwindcss` and UI catalog entries not used by www.

## Phase 4 — www additions (independent, can start anytime after Phase 0)

- Docs/API reference pages for the facade and converters.
- Small standalone viewer (`maplibre-gl` + `osmix` worker/raster protocol) without `@osmix/ui`/`app-components`.

## Verification

- Core after each phase: `pnpm run verify:all` (includes `knip`), CI green on `ci.yml` (Node/Bun/Deno runtime smoke).
- Each new repo: fresh `pnpm install` resolves only published `@osmix/*` versions (no `workspace:`), then format/lint/typecheck/test green.
- `tiles`: both servers boot and serve a tile from `monaco.pbf`.
- `cli`: `test:executable` passes under Bun; a dry-run release builds executables.
- `apps`: Playwright e2e for merge/inspect/extract pass; Vercel preview deploy works with COOP/COEP headers; cross-app `AppLinks` resolve.
- `@osmix/test-utils`: `npm pack` contents include the bundled fixtures and an external repo can load `monaco.pbf`.
