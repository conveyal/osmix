# Osmix Inspect

A Vite + React app for viewing a single OpenStreetMap PBF dataset in the browser: load a file or URL, browse stored datasets, search and select entities on the map, run within-dataset duplicate diagnostics, and route between two points.

It is the first consumer of the shared app packages besides the merge app:

- [`@osmix/ui`](../../packages/ui) — primitives, layout shell, design tokens
- [`@osmix/app-core`](../../packages/app-core) — worker remote, IndexedDB storage, jotai state, `useOsmFile`
- [`@osmix/app-components`](../../packages/app-components) — MapLibre basemap and protocols, `InspectPanel`, map controls

The app itself is a few files: `src/main.tsx` creates the worker remote and jotai store, `src/app.tsx` composes the panel and map, and `src/settings.ts` names the one dataset slot.

## Run

```sh
pnpm --filter @osmix/inspect dev
```

Dev runs on `inspect.osmix` through Portless. `?load=<fileHash>` opens a dataset already saved in this browser's storage; otherwise the most recently used dataset loads.

Like the merge app it needs COOP/COEP headers (set in `vite.config.ts` and `vercel.json`) so workers can share memory. Design conventions live in [`packages/ui/DESIGN.md`](../../packages/ui/DESIGN.md).
