# @osmix/shared

`@osmix/shared` hosts the low-level geometry, math, and infrastructure helpers
used across every Osmix package. Modules are published via subpath exports, so
import the functions you need directly from `@osmix/shared/<module>`.

## Highlights

- Geometry math (`haversine-distance`, `lineclip`, `relation-multipolygon`,
  `way-is-area`) with TypeScript typings and lon/lat-friendly utilities.
- Streaming helpers (`bytes-to-stream`, `stream-to-bytes`, `transform-bytes`)
  that normalize Node/Bun/Web APIs.
- Worker-friendly tooling (`progress`, `throttle`, `assert`) for consistent
  logging and defensive checks.

## Installation

```sh
bun install @osmix/shared
```

## Frequently used modules

| Module | Description |
| --- | --- |
| `@osmix/shared/assert` | Tiny invariant helpers that throw typed errors. |
| `@osmix/shared/bbox-intersects` | Bounding-box intersection + containment checks. |
| `@osmix/shared/bytes-to-stream` | Create a ReadableStream from a Uint8Array. |
| `@osmix/shared/coordinates` | Utilities for coordinate precision (7 decimal places). |
| `@osmix/shared/haversine-distance` | Great-circle distance (meters) for lon/lat pairs. |
| `@osmix/shared/lineclip` | Typed wrapper around `lineclip` for polylines/polygons. |
| `@osmix/shared/progress` | Shared `ProgressEvent` helpers + `logProgress`. |
| `@osmix/shared/relation-kind` | Detect relation types (multipolygon, route, etc). |
| `@osmix/shared/relation-multipolygon` | Builds multipolygon rings from relation members. |
| `@osmix/shared/stream-to-bytes` | Consume a ReadableStream into a Uint8Array. |
| `@osmix/shared/throttle` | Worker-safe throttling for logging/progress updates. |
| `@osmix/shared/tile` | Utilities for working with tile coordinates. |
| `@osmix/shared/transform-bytes` | Transform streams (gzip, etc) helper. |
| `@osmix/shared/utils` | General OSM entity utilities (equality, type checks). |
| `@osmix/shared/way-is-area` | Implements the OSM wiki “is area” heuristics. |
| `@osmix/shared/zigzag` | Protobuf-style zigzag encoding helpers. |

All modules are tree-shakeable; only import what you need.

## Related Packages

- [`@osmix/core`](../core/README.md) – In-memory OSM index using these shared utilities.
- [`@osmix/pbf`](../pbf/README.md) – PBF parsing that uses zigzag encoding and streaming helpers.
- [`@osmix/json`](../json/README.md) – JSON entity conversion using shared types.
- [`@osmix/geojson`](../geojson/README.md) – GeoJSON conversion using coordinate and type utilities.
- [`@osmix/change`](../change/README.md) – Changeset management using entity utilities.

## Development

- `bun run test packages/shared`
- `bun run lint packages/shared`
- `bun run typecheck packages/shared`

Run `bun run check` at the repo root before publishing to ensure formatting,
lint, and type coverage.
