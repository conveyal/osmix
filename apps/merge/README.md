# Osmix Merge

Osmix Merge is a Vite + React app for comparing and reconciling OpenStreetMap PBF datasets. It builds on [`@osmix/core`](../../packages/core/README.md) and [`@osmix/change`](../../packages/change/README.md) in a web worker, renders MapLibre raster and vector overlays, and guides you through a multi-step merge workflow that stays entirely in the browser.

## Highlights

- Load “base” and “patch” `.osm.pbf` files, preview differences, and step through merge tasks (direct merge, node/way deduplication, intersection creation).
- Visualize both datasets with raster previews produced on the worker thread plus interactive vector overlays for selected entities.
- Inspect individual OSM files, find duplicate entities, and apply the generated changes back into the in-memory index.
- Built-in Nominatim search, entity lookups, and task logging keep large merges manageable.

## Prerequisites

- Bun `1.3.x`
- Modern Chromium-based browser (Chrome/Edge ≥ 119 recommended). Safari/Firefox lack the `showSaveFilePicker` API and stable OffscreenCanvas transfer support.
- Running over `https://` or `http://localhost` so COOP/COEP headers can enable `crossOriginIsolated` mode for the worker raster pipeline.

## Install

```sh
bun install
```

Fixture PBF files live in `fixtures/` at the repository root. During development Vite serves this directory as the public asset folder (`publicDir`), so URLs like `./monaco.pbf` resolve without extra copying.

## Run the dev server

```sh
bun run --filter @osmix/merge dev
```

Vite runs on `http://localhost:5173` by default. Open the “Check system” dialog in the top navigation to confirm the page is secure and cross-origin isolated; polished raster rendering and large array allocations depend on it.

## Build for production

```sh
bun run --filter @osmix/merge build
```

Artifacts land in `apps/merge/dist/`. Deploy behind an HTTPS origin that sends the same COOP/COEP headers configured in `vite.config.ts`.

## End-to-end tests

```sh
bunx playwright install --with-deps   # first run
bun run --filter @osmix/merge test:e2e
```

Tests load sample fixtures from `fixtures/monaco.pbf` and exercise both Merge and Inspect flows.

## Core workflow

### Merge view (default route)

1. **Select OSM PBF files** – Upload base + patch files and review metadata. The files stay local thanks to the File System Access API.
2. **Review changeset** – Each step runs an operation on the worker (`osm.worker.ts`) that uses `@osmix/core` and `@osmix/change` to generate or update an `OsmixChangeset`. Logs stream into the sidebar while progress indicators update the UI.
3. **Inspect intermediary results** – Toggle MapLibre vector overlays to compare base/patch rasters, click features to see details, and jump the map to selected entities.
4. **Apply actions** – Deduplicate nodes or ways, generate direct changes, create intersections, and download the resulting change list as JSON. Applying the final changes replaces the in-memory base dataset.

The stepper resets selection state between actions, and you can jump backward or forward if you need to rerun a task.

### Inspect view (`/inspect`)

- Load a single PBF, run duplicate detection, and page through the resulting change list.
- Fit to the file’s bounding box, search for entities, and drill into their tags and relations.
- Apply deduplications directly to the dataset and immediately preview the updated geometry.

## Map & rendering stack

- **MapLibre** provides the background map (Carto dark matter style), interaction controls, and pickable vector overlays for base, patch, and selected entities.
- **Raster tiles** come from the worker’s `OsmixRasterTile` helper in [`@osmix/raster`](../../packages/raster/README.md), which draws ways and (at higher zoom levels) nodes onto an OffscreenCanvas before streaming the PNG bytes back to the UI thread.

## Worker architecture

- All heavy operations (PBF ingest, change generation, raster rendering) happen inside `src/workers/osm.worker.ts`, keeping the main thread responsive.
- The worker caches `Osmix` instances keyed by dataset id, exposes change pagination, and returns transferable typed arrays whenever possible.
- Logs from the worker are proxied back through `Log.addMessage` so long-running operations surface status updates.

## Data loading tips

- Upload local `.osm.pbf` / `.geojson` / `.json` files, or use **Open from URL** for hosted files (the host must allow browser downloads via CORS).
- Adjust the defaults in `src/settings.ts` if you want the app to reference local dev fixtures by URL.
- Large extracts work best when the browser has several gigabytes of free memory; use the “Check system” dialog to see current limits.
- Changes and temporary files never leave the browser unless you explicitly download them.

## Troubleshooting

- **Secure context warnings** – If the system check reports a missing secure context, make sure you’re on `https://` (or `localhost`) and disable extensions that inject insecure content.
- **File picker errors** – `showSaveFilePicker` currently requires Chromium; use Chrome/Edge when exporting JSON or merged PBFs.
- **Raster tiles missing** – Cross-origin isolation is required for OffscreenCanvas. Confirm the dev server sent the COOP/COEP headers listed in `vite.config.ts`.

## Related packages

- [`@osmix/change`](../../packages/change/README.md) – Change and merge machinery powering the worker steps.
- [`@osmix/pbf`](../../packages/pbf/README.md) – Low-level PBF parsing and streaming primitives.
- [`@osmix/json`](../../packages/json/README.md) – JSON ↔ PBF transforms and GeoJSON helpers.
- [`@osmix/core`](../../packages/core/README.md) – Typed-array OSM index.
- [`@osmix/raster`](../../packages/raster/README.md) – Raster map helpers used for the preview tiles.
