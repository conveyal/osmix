# Osmix

Osmix is a collection of tools for reading, inspecting, and manipulating OpenStreetMap PBF data in modern JavaScript environments. The first applications built with the tools are a simple OSM PBF inspection tool and [a merge tool](https://merge.osmix.dev). The individual libraries span low-level PBF parsing, JSON transforms, and generating vector tiles for any JavaScript environment.

## Getting started

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

### Packages
- [packages/core](packages/core/README.md) – Core `Osmix` engine for ingesting PBF streams, building spatial indexes, and emitting JSON, PBF, or vector and raster tiles.
- [packages/change](packages/change/README.md) – Change-management helpers that deduplicate entities, generate merge stats, and apply edits on top of `@osmix/core`.
- [packages/json](packages/json/README.md) – Easy-to-use streaming converters between PBF bytes and strongly typed JSON entities, plus GeoJSON helpers tuned to OSM conventions.
- [packages/pbf](packages/pbf/README.md) – Low-level toolkit that mirrors the official protobuf schema, offering streaming readers/writers, compression helpers, and generated type-safe codecs.
- [packages/raster](packages/raster/README.md) – Canvas-based raster tile renderer and MapLibre protocol built for `@osmix/core` datasets.
- [packages/vt](packages/vt/README.md) – Encodes Osmix binary overlays directly into Mapbox Vector Tiles with caching helpers.
- [packages/shared](packages/shared/README.md) – Small geometry utilities (`haversineDistance`, `clipPolyline`) shared across packages.

### Development
- `fixtures/` – sample extracts referenced by integration tests and the merge app.

## Resources

- [OpenStreetMap PBF format](https://wiki.openstreetmap.org/wiki/PBF_Format)
- [Bun](https://bun.sh/) workspace documentation
- [Vite](https://vitejs.dev/) build tooling
- [MapLibre GL JS](https://maplibre.org/projects/maplibre-gl-js/)
- [Web Compression Streams API](https://developer.mozilla.org/docs/Web/API/Compression_Streams_API)
