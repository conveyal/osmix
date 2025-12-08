# @osmix/router

`@osmix/router` builds a routable street network from OSM data and provides routing functionality to find paths between coordinates.

## Highlights

- Builds a directed graph from OSM ways and nodes
- Configurable highway type filtering
- Multiple routing algorithms (Dijkstra, A*, bidirectional search)
- Support for both distance and time-based routing
- Returns detailed route information including coordinates, way IDs, and node IDs
- Serializable graph format for Web Worker support

## Installation

```sh
bun install @osmix/router
```

## Usage

```ts
import { RoutingGraph, Router, findNearestNodeOnGraph } from "@osmix/router"
import { Osm } from "@osmix/core"

const osm = new Osm()
// ... load OSM data into osm ...

// Build routing graph
const graph = new RoutingGraph(osm)

// Snap coordinates to nearest routable nodes
const from = findNearestNodeOnGraph(osm, graph, [-73.989, 40.733], 0.5)
const to = findNearestNodeOnGraph(osm, graph, [-73.988, 40.734], 0.5)

if (from && to) {
	const router = new Router(osm, graph)
	const path = router.route(from.nodeIndex, to.nodeIndex)

	if (path) {
		const result = router.buildResult(path)
		console.log(result.coordinates) // Array of [lon, lat] coordinates
		console.log(result.wayIndexes) // Array of way indexes used
		console.log(result.nodeIndexes) // Array of node indexes for turns
	}
}
```

## API

### `RoutingGraph`

Build and manage a routing graph from OSM data. The graph uses a CSR (Compressed Sparse Row) format for efficient memory usage and cache locality.

```ts
import { RoutingGraph, defaultHighwayFilter } from "@osmix/router"

// Build from OSM data
const graph = new RoutingGraph(osm, defaultHighwayFilter)

// Properties
graph.size // Number of routable nodes
graph.edges // Total edge count
graph.isRouteable(nodeIndex) // Check if node is routable
graph.isIntersection(nodeIndex) // Check if node is an intersection
graph.getEdges(nodeIndex) // Get outgoing edges from node
```

#### `findNearestRoutableNode(osm, point, maxKm)`

Snap a geographic coordinate to the nearest routable node.

```ts
const nearest = graph.findNearestRoutableNode(osm, [-73.989, 40.733], 0.5)
if (nearest) {
	console.log(nearest.nodeIndex) // Internal node index
	console.log(nearest.coordinates) // Snapped [lon, lat]
	console.log(nearest.distance) // Distance from input point (meters)
}
```

**Constructor parameters:**

- `osm` - The `@osmix/core` dataset.
- `filter` - Optional function `(tags?) => boolean` to select routable ways. Default: common vehicle highways.
- `defaultSpeeds` - Optional speed limits (km/h) by highway type.

#### Serialization (Web Worker support)

`RoutingGraph` can be serialized and transferred between Web Workers:

```ts
// Build graph and get transferables
const graph = new RoutingGraph(osm)
const transferables = graph.transferables()

// Transfer to worker (zero-copy with SharedArrayBuffer)
worker.postMessage(transferables)

// Reconstruct in worker
const reconstructed = new RoutingGraph(transferables)
```

The `transferables()` method returns an object containing:

- `nodeCount`, `edgeCount` - Graph dimensions
- `edgeOffsets`, `edgeTargets`, `edgeWayIndexes` - CSR structure
- `edgeDistances`, `edgeTimes` - Edge weights
- `routableBits`, `intersectionBits` - Node flags

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

### Algorithms

| Algorithm       | Optimal? | Speed   | Best For                              |
| --------------- | -------- | ------- | ------------------------------------- |
| `dijkstra`      | Yes      | Slower  | When you need guaranteed shortest path |
| `astar`         | Yes      | Fast    | Point-to-point queries (default)      |
| `bidirectional` | No       | Fastest | Quick connectivity checks             |

## Related Packages

- [`@osmix/core`](../core/README.md) - In-memory OSM index with spatial queries.
- [`@osmix/shared`](../shared/README.md) - Haversine distance and coordinate utilities.
- [`osmix`](../osmix/README.md) - High-level API with worker support for routing.

## Development

- `bun run test packages/router`
- `bun run lint packages/router`
- `bun run typecheck packages/router`

Run `bun run check` at the repo root before publishing to ensure formatting, lint, and type coverage.
