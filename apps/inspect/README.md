# Osmix Inspect

A Vite + React app for viewing a single OpenStreetMap PBF dataset in the browser: load a file or URL, browse stored datasets, search and select entities on the map, find and fix duplicate nodes and ways, and route between two points.

Duplicate fixes are the step before merging: scan the dataset, review the candidates on the map, apply them, and download the cleaned PBF to open in Merge. Applying replaces the dataset open in the tab; the original file and any stored copy are unchanged. The rules are in [MP-I5](../../docs/merge-process.md#mp-i5).

It is the first consumer of the shared app packages besides the merge app:

- [`@osmix/ui`](../../packages/ui) — primitives, layout shell, design tokens
- [`@osmix/app-core`](../../packages/app-core) — worker remote, IndexedDB storage, jotai state, `useOsmFile`
- [`@osmix/app-components`](../../packages/app-components) — MapLibre basemap and protocols, `InspectPanel`, `OsmixMap` (toolbar, inspector, legend, routing tool)

The app itself is a few files: `src/main.tsx` creates the worker remote and jotai store, `src/app.tsx` composes the panel and map, and `src/settings.ts` names the one dataset slot.

## Run

```sh
pnpm --filter @osmix/inspect dev
```

Production: [inspect.osmix.dev](https://inspect.osmix.dev). Dev runs on `inspect.osmix.localhost` through Portless. `?load=<fileHash>` opens a dataset already saved in this browser's storage; otherwise the most recently used dataset loads.

Like the merge app it needs COOP/COEP headers (set in `vite.config.ts` and `vercel.json`) so workers can share memory. Design conventions live in [`packages/ui/DESIGN.md`](../../packages/ui/DESIGN.md).
