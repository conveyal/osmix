# vt-server

Example vector tile server that serves Mapbox Vector Tiles (MVT) from an OSM PBF file. Uses Osmix workers for off-thread tile generation.

## Setup

```bash
pnpm install
```

## Run

```bash
pnpm run dev
```

The server starts through Portless at `https://vt.osmix.localhost` and loads the Monaco fixture PBF from the repo. Branch worktrees add their branch as a prefix; detached worktrees use their Git worktree ID. Set `PORTLESS=0` to bypass the proxy and use the direct `HOST`/`PORT` server settings (default `127.0.0.1:3000`).

## Endpoints

- `GET /` – Map viewer (MapLibre GL)
- `GET /ready` – Server readiness and load progress
- `GET /meta.json` – Bbox, center, and layer metadata
- `GET /tiles/:z/:x/:y` – Vector tiles (MVT)
- `GET /search/:key=:value` – Tag search (e.g. `/search/amenity=restaurant`)

## Customization

Edit `server.ts` to change the PBF path or add routes. The server uses `createRemote` from Osmix to load PBF data and generate tiles in Web Workers.
