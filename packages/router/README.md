# @osmix/router

`@osmix/router` builds a routeable street network from OSM data and provides routing functionality to find paths between coordinates.

## Highlights

- Builds a directed graph from OSM ways and nodes
- Configurable highway type filtering
- Multiple routing algorithms (Dijkstra, A*, bidirectional search)
- Support for both distance and time-based routing
- Returns detailed route information including coordinates, way IDs, and node IDs

## Installation

```sh
bun install @osmix/router
```

## Usage

```ts
import { Router } from "@osmix/router"
import { Osm } from "@osmix/core"

const osm = new Osm()
// ... load OSM data into osm ...

const router = new Router(osm, {
	highwayFilter: (tags) => {
		const highway = tags?.highway
		return highway === "motorway" || highway === "primary" || highway === "secondary"
	}
})

const route = router.route([-73.989, 40.733], [-73.988, 40.734])

console.log(route.coordinates) // Array of [lon, lat] coordinates
console.log(route.wayIds) // Array of way IDs used in order
console.log(route.nodeIds) // Array of node IDs for turns and crossings
```

## API

### `buildGraph(osm, filter?, defaultSpeeds?)`

Build a routing graph from OSM data.

```ts
import { buildGraph, defaultHighwayFilter } from "@osmix/router"

const graph = buildGraph(osm, defaultHighwayFilter)
```

**Parameters:**

- `osm` - The `@osmix/core` dataset.
- `filter` - Optional function `(tags?) => boolean` to select routable ways. Default: common vehicle highways.
- `defaultSpeeds` - Optional speed limits (km/h) by highway type.

### `Router`

High-level routing interface.

```ts
const router = new Router(osm, graph, { algorithm: "astar", metric: "time" })
```

**Methods:**

- `route(fromNodeIndex, toNodeIndex, options?)` - Find path between nodes. Returns `PathSegment[]` or `null`.
- `buildResult(path)` - Convert path to `RouteResult` with coordinates and metadata.

**Options:**

- `algorithm` - `"dijkstra"` | `"astar"` | `"bidirectional"` (default: `"astar"`)
- `metric` - `"distance"` | `"time"` (default: `"distance"`)

### `findNearestNodeOnGraph(osm, graph, point, maxKm)`

Snap a geographic coordinate to the nearest routable node.

```ts
const nearest = findNearestNodeOnGraph(osm, graph, [-73.989, 40.733], 0.5)
if (nearest) {
  const path = router.route(nearest.nodeIndex, destNodeIndex)
}
```

### Algorithms

| Algorithm | Optimal? | Speed | Best For |
| --- | --- | --- | --- |
| `dijkstra` | Yes | Slower | When you need guaranteed shortest path |
| `astar` | Yes | Fast | Point-to-point queries (default) |
| `bidirectional` | No | Fastest | Quick connectivity checks |

## Related Packages

- [`@osmix/core`](../core/README.md) – In-memory OSM index with spatial queries.
- [`@osmix/shared`](../shared/README.md) – Haversine distance and coordinate utilities.
- [`osmix`](../osmix/README.md) – High-level API for loading OSM data.

## Development

- `bun run test packages/router`
- `bun run lint packages/router`
- `bun run typecheck packages/router`

Run `bun run check` at the repo root before publishing to ensure formatting, lint, and type coverage.

