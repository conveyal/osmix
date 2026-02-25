# vt-server

Example vector tile server that serves Mapbox Vector Tiles (MVT) from an OSM PBF file. Uses Osmix workers for off-thread tile generation.

## Setup

```bash
bun install
```

## Run

```bash
bun run dev
```

The server starts on `http://localhost:3000` (or `PORT` env var) and loads the Monaco fixture PBF from the repo.

## Endpoints

- `GET /` – Map viewer (MapLibre GL)
- `GET /ready` – Server readiness and load progress
- `GET /meta.json` – Bbox, center, and layer metadata
- `GET /tiles/:z/:x/:y` – Vector tiles (MVT)
- `GET /search/:key=:value` – Tag search (e.g. `/search/amenity=restaurant`)

## Customization

Edit `server.ts` to change the PBF path or add routes. The server uses `createRemote` from Osmix to load PBF data and generate tiles in Web Workers.
