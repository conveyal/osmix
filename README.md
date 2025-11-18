# Osmix

> An ecosystem of tools to work with OpenStreetMap data in TypeScript.

## Introduction

Welcome to Osmix, a powerful collection of tools for reading, inspecting, and manipulating OpenStreetMap PBF data in modern JavaScript environments. The first applications built with the tools are a simple OSM PBF inspection tool and [a merge tool](https://merge.osmix.dev). The individual libraries span low-level PBF parsing, JSON transforms, and generating vector tiles for any JavaScript environment.

## Getting started

Install `osmix`

```bash
bun install osmix
```

Read a PBF.

```ts
import {Osmix} from 'osmix'

const monacoPbf = Bun.file('./monaco.pbf')

const osm = await Osmix.fromPbf(monacoPbf.stream())
```

Read a PBF off the main thread in a `Worker` thread.

```ts
import {OsmixRemote} from 'osmix'
const Osmix = await OsmixRemote.connect()
const osmInfo = await Osmix.fromPbf(monacoPbf.stream())

```

## Monorepo Structure

| Package | Description | README |
|--|--|--|
| 'osmix' | Main library packaging all of the individual tools into an API. | [README](packages/osmix/README.md) |
| `@osmix/core` | In-memory engine for ingesting PBF streams, building indexes, and emitting OSM data. | [README](packages/core/README.md) |
| `@osmix/change` | Helpers for deduplication, merge stats, and applying changesets atop core data. | [README](packages/change/README.md) |
| `@osmix/json` | Streaming transforms: convert OSM PBF bytes to strongly typed JSON and GeoJSON. | [README](packages/json/README.md) |
| `@osmix/pbf` | Low-level library for OSM PBF protobuf parsing, compression, and code generation. | [README](packages/pbf/README.md) |
| `@osmix/raster` | Renders canvased raster tiles and registers the custom MapLibre protocol for Osmix. | [README](packages/raster/README.md) |
| `@osmix/vt` | Encodes overlays as Mapbox Vector Tiles (MVT) and provides caching helpers. | [README](packages/vt/README.md) |
| `@osmix/shared` | Utility functions and geometry helpers used throughout all workspace packages. | [README](packages/shared/README.md) |


## Development

1. Install dependencies with `bun install`.
2. Run all workspace apps in watch mode via `bun run dev`.
3. Build production artifacts for packages and apps using `bun run build`.
4. Execute Vitest suites with `bun run test` and type coverage with `bun run typecheck`.
5. Enforce formatting and lint rules using `bun run lint`, `bun run format`, or the combined `bun run check` before sending a PR.

The workspace uses a single root `package.json` to coordinate shared scripts, dependency versions, and Bun workspace filters (for example, `bun run --filter @osmix/merge dev`).

## Workspace

### Apps
- [apps/merge](apps/merge/README.md) – Vite + React app that compares base and patch extracts, renders MapLibre raster and vector overlays, and guides multi-step merge workflows entirely in-browser.
- [apps/bench](apps/bench/README.md) – Experimental benchmark UI that contrasts Osmix operations with DuckDB-wasm queries using shared fixtures.
- [apps/vt-server](apps/vt-server/README.md) - Example of using Osmix as a simple vector tile server.

### Development
- `fixtures/` – sample extracts referenced by integration tests and the merge app.

## Resources

- [OpenStreetMap PBF format](https://wiki.openstreetmap.org/wiki/PBF_Format)
- [Bun](https://bun.sh/) workspace documentation
- [Vite](https://vitejs.dev/) build tooling
- [MapLibre GL JS](https://maplibre.org/projects/maplibre-gl-js/)
- [Web Compression Streams API](https://developer.mozilla.org/docs/Web/API/Compression_Streams_API)
