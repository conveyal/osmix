# Osmix Extract

A Vite + React app for cutting a bounding-box extract out of an OpenStreetMap PBF in the browser: select a source PBF, choose a bbox (find a place with the search in step 2, drag the corners on the map, edit the coordinates, or use the file's own header bounds), pick an extract strategy (simple, complete ways, smart) and optional tag filters, then save the result to browser storage or export it as a PBF. Until you edit the bbox, selecting a file starts it from the file's header bounds, so you can narrow it from there.

Production: [extract.osmix.dev](https://extract.osmix.dev). Dev runs on `extract.osmix.localhost` through Portless. The app is built on the shared packages ([`@osmix/ui`](../../packages/ui), [`@osmix/app-core`](../../packages/app-core), [`@osmix/app-components`](../../packages/app-components)); `src/extract-panel.tsx` is the form, `src/app.tsx` composes it with `OsmixMap` (toolbar, map search, inspector, legend) and the extract's own layers: the bbox rectangle with draggable corners, and a long-dashed outline of the selected file's header bounds so a bbox that misses the file is visibly outside it.

Each app runs on its own origin, so an extract is not shared with [Merge](../merge/README.md) automatically. Export it and open it there.

## Run

```sh
pnpm --filter @osmix/extract dev
```

Design conventions live in [`packages/ui/DESIGN.md`](../../packages/ui/DESIGN.md).
