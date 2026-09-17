# Osmix Extract

A Vite + React app for cutting a bounding-box extract out of an OpenStreetMap PBF in the browser: choose a bbox on the map or by coordinates, pick an extract strategy (simple, complete ways, smart) and optional tag filters, select a source PBF, then save the result to browser storage or download it as a PBF.

Production: [extract.osmix.dev](https://extract.osmix.dev). Dev runs on `extract.osmix.localhost` through Portless. The app is built on the shared packages ([`@osmix/ui`](../../packages/ui), [`@osmix/app-core`](../../packages/app-core), [`@osmix/app-components`](../../packages/app-components)); `src/extract-panel.tsx` is the form, `src/app.tsx` composes it with the map.

Each app runs on its own origin, so an extract is not shared with [Merge](../merge/README.md) automatically. Download it and open it there.

## Run

```sh
pnpm --filter @osmix/extract dev
```

Design conventions live in [`packages/ui/DESIGN.md`](../../packages/ui/DESIGN.md).
