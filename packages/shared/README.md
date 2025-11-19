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

## Usage

```ts
import { haversineDistance } from "@osmix/shared/haversine-distance"
import { clipPolyline } from "@osmix/shared/lineclip"
import { logProgress } from "@osmix/shared/progress"

const meters = haversineDistance([-122.33, 47.61], [-122.30, 47.63])

const segments = clipPolyline(
	[
		[-122.33, 47.61],
		[-122.31, 47.62],
	],
	[-122.40, 47.50, -122.20, 47.70],
)

logProgress({ message: "Clipped segments", data: segments.length })
```

## Frequently used modules

| Module | Description |
| --- | --- |
| `@osmix/shared/assert` | Tiny invariant helpers that throw typed errors. |
| `@osmix/shared/bbox-intersects` | Bounding-box intersection + containment checks. |
| `@osmix/shared/haversine-distance` | Great-circle distance (meters) for lon/lat pairs. |
| `@osmix/shared/lineclip` | Typed wrapper around `lineclip` for polylines/polygons. |
| `@osmix/shared/relation-multipolygon` | Builds multipolygon rings from relation members. |
| `@osmix/shared/spherical-mercator` | Web-mercator projections geared toward XYZ tiles. |
| `@osmix/shared/throttle` | Worker-safe throttling for logging/progress updates. |
| `@osmix/shared/progress` | Shared `ProgressEvent` helpers + `logProgress`. |
| `@osmix/shared/way-is-area` | Implements the OSM wiki “is area” heuristics. |
| `@osmix/shared/zigzag` | Protobuf-style zigzag encoding helpers. |

All modules are tree-shakeable; only import what you need.

## Development

- `bun run test packages/shared`
- `bun run lint packages/shared`
- `bun run typecheck packages/shared`

Run `bun run check` at the repo root before publishing to ensure formatting,
lint, and type coverage.
