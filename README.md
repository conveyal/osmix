# Osmix

Osmix is a TypeScript monorepo for reading, inspecting, and merging OpenStreetMap PBF data in modern runtimes and the browser. It combines a worker-driven merge UI with libraries that span low-level PBF parsing, JSON transforms, and efficient typed-array indexes designed for any JavaScript 
environment.

## Architecture highlights

- End-to-end merges work in the browser on country scale workloads thanks to worker-hosted `@osmix/core`, the change orchestration in `@osmix/change`, OffscreenCanvas rasterization, and the File System Access API.
- Typed-array indexes, `transferables()`, and streaming transforms keep large datasets memory efficient across Web Workers, Bun, and Node 20+.
- JSON and PBF layers interoperate: `@osmix/pbf` exposes spec-close block readers while `@osmix/json` upgrades them into ergonomic entities or GeoJSON.
- Shared tooling relies on Bun `1.3.x`, Vite, React, MapLibre, deck.gl, and the Web Compression Streams API.

## Getting started

1. Install dependencies with `bun install`.
2. Run all workspace apps in watch mode via `bun run dev`.
3. Build production artifacts for packages and apps using `bun run build`.
4. Execute Vitest suites with `bun run test` and type coverage with `bun run typecheck`.
5. Enforce formatting and lint rules using `bun run lint`, `bun run format`, or the combined `bun run check` before sending a PR.

The workspace uses a single root `package.json` to coordinate shared scripts, dependency versions, and Bun workspace filters (for example, `bun run --filter @osmix/merge dev`).

## Workspace

- [packages/core](packages/core/README.md) – Core `Osmix` engine for ingesting PBF streams, building spatial indexes, and emitting JSON, PBF, or raster tiles.
- [packages/change](packages/change/README.md) – Change-management helpers that deduplicate entities, generate merge stats, and apply edits on top of `@osmix/core`.
- [apps/merge](apps/merge/README.md) – Vite + React app that compares base and patch extracts, renders MapLibre + deck.gl overlays, and guides multi-step merge workflows entirely in-browser.
- [packages/json](packages/json/README.md) – easy to use streaming converters between PBF bytes and strongly typed JSON entities, plus GeoJSON helpers tuned to OSM conventions.
- [packages/pbf](packages/pbf/README.md) – low-level toolkit that mirrors the official protobuf schema, offering streaming readers/writers, compression helpers, and generated type-safe codecs.
- [packages/raster](packages/raster/README.md) – Canvas-based raster tile renderer and MapLibre protocol built for `@osmix/core` datasets.

### Development
- `packages/test-utils` – shared Vitest fixtures and helpers used across packages.
- `fixtures/` – gzipped sample extracts referenced by integration tests and the merge app.

## Resources

- [OpenStreetMap PBF format](https://wiki.openstreetmap.org/wiki/PBF_Format)
- [Bun](https://bun.sh/) workspace documentation
- [Vite](https://vitejs.dev/) build tooling
- [MapLibre GL JS](https://maplibre.org/projects/maplibre-gl-js/) & [deck.gl](https://deck.gl/)
- [Web Compression Streams API](https://developer.mozilla.org/docs/Web/API/Compression_Streams_API)
