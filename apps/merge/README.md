# Osmix Merge

Osmix Merge is a Vite + React app for comparing and reconciling OpenStreetMap PBF datasets. It builds on [`@osmix/core`](../../packages/core/README.md) and [`@osmix/change`](../../packages/change/README.md) in a web worker, renders MapLibre raster and vector overlays, and guides you through a multi-step merge workflow that stays entirely in the browser.

## Highlights

- Load authoritative base and imported patch `.osm.pbf` files, preview differences, and step through direct
  merge, exact reconciliation, optional imported-data matching, and intersection creation.
- Select Auto, Full, or View loading according to the dataset and available browser memory.
- Visualize both datasets with raster previews produced on the worker thread plus interactive vector overlays for selected entities.
- Inspect individual OSM files for possible duplicate entities without mutating the source data.
- Opt in to reviewed, one-meter proximity matching for importing selected properties or attaching compatible imported networks without rewriting base geometry.
- Built-in Nominatim search, entity lookups, and task logging keep large merges manageable.

## Prerequisites

- Node.js 20+ and pnpm
- Modern Chromium-based browser (Chrome/Edge ≥ 119 recommended). Safari/Firefox lack the `showSaveFilePicker` API and stable OffscreenCanvas transfer support.
- Running over `https://` or `http://localhost` so COOP/COEP headers can enable `crossOriginIsolated` mode for the worker raster pipeline.

## Install

```sh
pnpm install
```

Fixture PBF files live in `fixtures/` at the repository root. During development Vite serves this directory as the public asset folder (`publicDir`), so URLs like `./monaco.pbf` resolve without extra copying.

## Run the dev server

```sh
pnpm run --filter @osmix/merge dev
```

Vite runs through Portless at `https://merge.osmix.localhost`. Worktrees add a unique prefix to that hostname. Open the “Check system” dialog in the top navigation to confirm the page is secure and cross-origin isolated; polished raster rendering and large array allocations depend on it. Set `PORTLESS=0` to bypass Portless and run Vite directly.

## Build for production

```sh
pnpm run --filter @osmix/merge build
```

Artifacts land in `apps/merge/dist/`. Deploy behind an HTTPS origin that sends the same COOP/COEP headers configured in `vite.config.ts`.

## End-to-end tests

```sh
pnpm exec playwright install --with-deps   # first run
pnpm run --filter @osmix/merge test:e2e
```

The worker harness loads `fixtures/monaco.pbf`; the guidance harness renders the real merge-step disclosure
components and checks keyboard interaction, state isolation, and narrow-sidebar layout.

## Core workflow

### Loading profiles

The PBF input's Advanced selector defaults to **Auto**:

- **Full** builds all-node and tagged-node indexes plus way and relation indexes.
- **View** omits the all-node index but retains tagged-node, way, and relation indexes for map rendering,
  tag search, and node/way/relation inspection.
- **Auto** selects Full only when its all-node index is at most 256 MiB, its projected typed-buffer peak is
  within the smaller of 4 GiB and 40% of the reported device-memory class, and each allocation is below 80%
  of the tested active-buffer ceiling. It otherwise selects View.

File information shows the requested and selected profiles, available spatial capabilities, memory
projections, storage estimate, budgets, and selection reasons. Check System distinguishes the reported device
memory class from separately tested `ArrayBuffer` and `SharedArrayBuffer` ceilings; typed-array element counts
are derived from those tested byte ceilings.

When View omits the all-node index, merge, exact node/way reconciliation, complete/smart extraction, routing, and
other all-node-dependent controls are disabled with an explanation and a **Reload using Full** action. Simple
in-stream extraction remains available. The app does not build the large index synchronously on first use.

### Merge view (default route)

The [merge-process guide](../../docs/merge-process.md) owns the merge rules, examples, and known limitations. Read its [input identity requirements](../../docs/merge-process.md#inputs-and-identity) before combining independently prepared imports.

1. Load the base and patch in Full mode.
2. Choose **Run automatic merge** or **Review each merge stage**, and configure optional imported-data matching.
3. In the reviewed workflow, inspect previews and choose Copy tags, Connect network, and optional explicit Remove imported way independently.
4. Complete application and intersection work, read the applied/unresolved summary, and download the result.

See [automatic and reviewed workflows](../../docs/merge-process.md#application-workflows) for the exact checkpoint order, cancellation boundaries, and recovery actions. Each numbered app stage also has a collapsed **How this step works** explanation. Matching discovery, scheduled actions, previews, and completed application are distinct states.

### Inspect tab

- Load a single PBF, run diagnostic duplicate detection, and page through the resulting candidate list.
- Fit to the file’s bounding box, search for entities, and drill into their tags and relations.
- Investigate candidates against the source data; the Inspect view does not apply proximity-based changes.

## Map & rendering stack

- **MapLibre** provides the background map (Carto dark matter style), interaction controls, and pickable vector overlays for base, patch, and selected entities.
- **Raster tiles** come from the worker’s `OsmixRasterTile` helper in [`@osmix/raster`](../../packages/raster/README.md), which draws ways and (at higher zoom levels) nodes onto an OffscreenCanvas before streaming the PNG bytes back to the UI thread.

## Worker architecture

- All heavy operations (PBF ingest, change generation, routing, and tile rendering) run in a managed worker pool, keeping the main thread responsive. Cross-origin-isolated browsers reserve one logical core for the UI and use up to four workers.
- Stateful loading, IndexedDB writes, and changesets stay on the control worker. Read-only tiles and queries use available compute workers, with queued MapLibre tile requests cancelled when the map no longer needs them.
- Workers cache `Osmix` instances keyed by dataset id, share their backing buffers, expose change pagination, and return transferable typed arrays whenever possible.
- If a single non-shared worker restarts, datasets previously loaded from IndexedDB are reconstructed with a read-only replay before the slot accepts more work. One-shot mutations and IndexedDB writes are never retried.
- Active imported-data discovery options, filters, and review decisions are replayed after a recoverable control-worker restart while both untouched inputs still exist. Applying the cumulative merge invalidates that review session.
- Local PBF files are hashed incrementally from `File.stream()` in a worker, avoiding a second whole-file
  input buffer. PBF URLs are hashed while the parser consumes a single response, then re-keyed to the final
  lowercase SHA-256 without copying the dataset buffers.
- Logs from the worker are proxied back through `Log.addMessage` so long-running operations surface status updates.
- Failed dataset loads remain visible beside their source controls and in Activity. The inline panel explains
  the failing phase, required and tested buffer sizes when available, an actionable next step, and expandable
  technical details; handled load failures do not leave an unhandled UI rejection.

## Data loading tips

- Upload local `.osm.pbf` / `.geojson` / `.json` / `.zip` (Shapefile) files, or use **Open from URL** for hosted files (the host must allow browser downloads via CORS).
- Adjust the defaults in `src/settings.ts` if you want the app to reference local dev fixtures by URL.
- Large extracts work best in a cross-origin-isolated Chromium browser with `SharedArrayBuffer`. Use Check
  System to inspect the reported memory class and tested buffer ceilings before loading.
- IndexedDB uses schema version 3. Upgrading intentionally recreates the OSM store and clears incompatible
  version 1/2 datasets. Persistence is offered only when the exact storable transfer size fits the available
  quota; the compressed PBF file size is not used as a proxy.
- Changes and temporary files never leave the browser unless you explicitly download them.

See [Australia-scale manual verification](./AUSTRALIA-PBF-CHECKLIST.md) for the large-file acceptance run.

## Troubleshooting

- **Secure context warnings** – If the system check reports a missing secure context, make sure you’re on `https://` (or `localhost`) and disable extensions that inject insecure content.
- **File picker errors** – Exports try native `showSaveFilePicker` first, then automatically fall back to browser download when picker APIs are unavailable/restricted.
- **Raster tiles missing** – Cross-origin isolation is required for OffscreenCanvas. Confirm the dev server sent the COOP/COEP headers listed in `vite.config.ts`.
- **A control requires Full** – The dataset was loaded without an all-node index. Use the offered reload action
  and select Full; the app does not construct that index lazily.
- **A core typed-array allocation failed** – The panel identifies the mandatory entity column and compares its
  single-buffer requirement with the current browser's tested ceiling. Auto, Full, and View retain core entity
  columns, so use a smaller regional extract when the panel says changing profiles cannot help.
- **A file was merged with an older Osmix release** – Older merges may have normalized each input before
  combining them, which can change routing topology. Regenerate the output from the original base and patch
  PBFs; the resulting file cannot be repaired reliably after references have been rewritten.
- **A merge reports new routing-integrity problems** – The result was rejected before replacing the base.
  Inspect the reported entity IDs for missing references, degenerate highways, or detached turn restrictions,
  then correct the source data rather than discarding the affected restriction.
- **A restriction reports a detached via node** – Inspect the reported restriction, via node, and from/to way
  IDs. The via node must belong to the participating ways at their shared junction; correct those references in
  the source data and rerun the merge.
- **A proximity candidate is blocked** – Review its reason code and map comparison. Grade conflicts,
  restrictions, relation membership, and changes that would collapse a way cannot be overridden. Multiple
  targets and other uncertain candidates require an explicit accepted target or can be left unchanged.

## Related packages

- [`@osmix/change`](../../packages/change/README.md) – Change and merge machinery powering the worker steps.
- [`@osmix/load`](../../packages/load/README.md) – PBF loading, geographic extracts, and export.
- [`@osmix/pbf`](../../packages/pbf/README.md) – Low-level PBF parsing and streaming primitives.
- [`@osmix/json`](../../packages/json/README.md) – JSON ↔ PBF transforms and GeoJSON helpers.
- [`@osmix/core`](../../packages/core/README.md) – Typed-array OSM index.
- [`@osmix/raster`](../../packages/raster/README.md) – Raster map helpers used for the preview tiles.
