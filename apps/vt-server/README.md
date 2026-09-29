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

From the repo root, this starts the server through Portless at `https://vt-server.osmix.localhost`, with the other apps. Branch worktrees add their branch as a prefix. From this directory, `pnpm run dev` starts only this server, without Portless, on the `HOST`/`PORT` settings (default `127.0.0.1:3000`). The server loads the Monaco fixture PBF from the repo.

## Endpoints

- `GET /` – Map viewer (MapLibre GL)
- `GET /ready` – Server readiness and load progress
- `GET /meta.json` – Bbox, center, and layer metadata
- `GET /tiles/:z/:x/:y` – Vector tiles (MVT)
- `GET /search/:key=:value` – Tag search (e.g. `/search/amenity=restaurant`)

## Customization

Edit `server.ts` to change the PBF path or add routes. The server uses `createRemote` from Osmix to load PBF data and generate tiles in Web Workers.
