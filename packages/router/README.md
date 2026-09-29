# @osmix/router

`@osmix/router` builds a routable street network from OSM data and provides routing functionality to find paths between coordinates.

## Highlights

- Builds a directed graph from OSM ways and nodes
- Respects explicit one-way tags and the one-way direction implied by `junction=roundabout`
- Configurable highway type filtering
- Multiple routing algorithms (Dijkstra, A\*, bidirectional search)
- Support for both distance and time-based routing
- Returns detailed route information including coordinates, way IDs, and node IDs
- Serializable graph format for Web Worker support

## Installation

```sh
pnpm add @osmix/router
```

## Usage

```ts check-docs
import { Osm, Router, RoutingGraph } from "osmix";

const osm = new Osm();
// ... load OSM data into osm ...

// Build routing graph
const graph = new RoutingGraph(osm);

// Snap coordinates to nearest routable nodes
const from = graph.findNearestRoutableNode(osm, [-73.989, 40.733], 500);
const to = graph.findNearestRoutableNode(osm, [-73.988, 40.734], 500);

if (from && to) {
  const router = new Router(osm, graph);
  const path = router.route(from.nodeIndex, to.nodeIndex);

  if (path) {
    const result = router.buildResult(path);
    console.log(result.coordinates); // Array of [lon, lat] coordinates
    console.log(result.wayIndexes); // Array of way indexes used
    console.log(result.nodeIndexes); // Array of node indexes for turns
  }
}
```

## API

### `RoutingGraph`

Build and manage a routing graph from OSM data. The graph uses a CSR (Compressed Sparse Row) format for efficient memory usage and cache locality.

```ts check-docs osm
import { RoutingGraph, defaultHighwayFilter } from "osmix";

// Build from OSM data
const graph = new RoutingGraph(osm, defaultHighwayFilter);
const nodeIndex = 0;

// Properties
graph.size; // Number of node slots: every node in the dataset, routable or not
graph.edges; // Total edge count
graph.isRoutable(nodeIndex); // Check if node is routable
graph.isIntersection(nodeIndex); // Check if node is an intersection
graph.getEdges(nodeIndex); // Get outgoing edges from node
graph.getIncomingEdges(nodeIndex); // Get incoming edges (targetNodeIndex is the source)
graph.maxSpeedMps; // Fastest edge speed, used to bound the A* time heuristic
```

#### `findNearestRoutableNode(osm, point, maxDistanceM)`

Snap a geographic coordinate to the nearest routable node. The radius is in meters. It snaps to graph nodes only, not to points along an edge. It needs the all-node spatial index (the Full load profile) and throws `SpatialIndexNotBuiltError` without it.

```ts check-docs router-context
const nearest = graph.findNearestRoutableNode(osm, [-73.989, 40.733], 500);
if (nearest) {
  console.log(nearest.nodeIndex); // Internal node index
  console.log(nearest.coordinates); // Snapped [lon, lat]
  console.log(nearest.distance); // Distance from input point (meters)
}
```

**Constructor parameters:**

- `osm` - The `@osmix/core` dataset.
- `filter` - Optional function `(tags?) => boolean` to select routable ways. Default: `defaultHighwayFilter` (motorway to service roads). `defaultPedestrianFilter` selects footways, paths, cycleways, bridleways and steps.
- `defaultSpeeds` - Optional speed limits (km/h) by highway type. Default: `DEFAULT_SPEEDS`. A way's `maxspeed` tag takes priority (`parseMaxSpeed` reads numbers, `mph`, `walk` and `none`). Unknown types use 50 km/h.

Ways with a ref to a node that is not in the dataset (for example, after a bbox extract) keep their other segments. The segments that touch the missing node are not added.

Way directionality is currently graph-wide: custom filters can select pedestrian ways, but they
do not disable `oneway` or implicit roundabout direction. A custom filter does not supply a complete pedestrian or turn-restriction policy. The [optional local R5 comparison](../osmix/test/r5/README.md) evaluates declared fixture checks against a specific R5 checkout; coordinate linking and diagnostic observations do not establish complete modal legality.

#### Way direction

Graph construction and exact/fuzzy way matching share `normalizedWayDirection(tags)`, available from
`osmix` or `@osmix/types/way-direction`. It returns `OsmWayDirection`: `forward`, `reverse`, `both`, or
`unsupported`. Forward follows the way's ordered node references; reverse travels against that order.

| `oneway` value                              | Normalized direction             |
| ------------------------------------------- | -------------------------------- |
| `yes`, `true`, `1`                          | `forward`                        |
| `reverse`, `-1`                             | `reverse`                        |
| `no`, `false`, `0`                          | `both`, including on roundabouts |
| Absent or empty, with `junction=roundabout` | `forward`                        |
| Absent or empty, on other ways              | `both`                           |
| Any other nonempty value                    | `unsupported`                    |

One-way aliases are case-insensitive, and numeric values normalize like their string equivalents. Values
are not trimmed: `" yes "` is unsupported. The roundabout implication requires the literal
`junction=roundabout` value.

```ts check-docs
import { normalizedWayDirection } from "osmix";

const direction = normalizedWayDirection({ junction: "roundabout", oneway: "0" });
console.log(direction); // "both"
```

Unsupported values such as `reversible` and `alternating` prevent exact or fuzzy way matching from treating
two ways as direction-equivalent, even when their values are identical. The routing graph retains its existing
approximation for such values: forward on roundabouts and both directions on other ways. This fallback does
not model their actual rules. Conditional, time-dependent, lane-specific, and mode-specific one-way rules are
not evaluated by this normalization.

Fuzzy matching also needs a reliable geometry orientation before comparing one-way travel. It blocks one-way
candidates whose endpoints fit equally well in either order, including closed one-way loops. This matching
limit does not change their routing graph: graph edges always follow the stored references and normalized
tag direction.

#### Serialization (Web Worker support)

`RoutingGraph` can be serialized and transferred between Web Workers:

```ts check-docs router-transfer
import { getTransferableBuffers, RoutingGraph } from "@osmix/router";

// Build graph and get transferables
const transferables = graph.transferables();
const buffers = getTransferableBuffers(transferables);

// Transfer to worker without cloning ArrayBuffers
worker.postMessage(transferables, buffers);

// Reconstruct in worker
const reconstructed = new RoutingGraph(transferables);
console.log(reconstructed.size);
```

The `transferables()` method returns an object containing:

- `nodeCount`, `edgeCount` - Graph dimensions
- `edgeOffsets`, `edgeTargets`, `edgeWayIndexes` - CSR structure
- `edgeDistances`, `edgeTimes` - Edge weights
- `routableBits`, `intersectionBits` - Node flags

### `Router`

High-level routing interface.

Schematic construction with route options:

```ts schematic
const router = new Router(osm, graph, { algorithm: "astar", metric: "time" });
```

**Methods:**

- `route(fromNodeIndex, toNodeIndex, options?)` - Find path between nodes. Returns `PathSegment[]` or `null`.
- `buildResult(path, options?)` - Convert path to `RouteResult` with `coordinates`, `wayIndexes` and `nodeIndexes`.
- `getRouteStatistics(path)` - Total `distance` (meters) and `time` (seconds).
- `getRoutePathInfo(path)` - `segments` (consecutive ways with the same name merged) and `turnPoints`.

**Options:**

- `algorithm` - `"dijkstra"` | `"astar"` | `"bidirectional"` (default: `"astar"`)
- `metric` - `"distance"` | `"time"` (default: `"distance"`)
- `includeStats` - Add `distance` and `time` to the `RouteResult` (default: `false`)
- `includePathInfo` - Add `segments` and `turnPoints` to the `RouteResult` (default: `false`)

### `routingTopologyStats(source, filter)`

Gives the counts a `RoutingGraph` built with `filter` would have (`nodes`, `routableNodes`, directed `edges` and weakly connected `components`) without building the graph. `source` is anything with a `nodeCount` and a `ways()` iterable of `{ tags, refs }`, so an `Osm` or a view of pending changes both work. Direction follows the graph, including the roundabout fallback.

```ts schematic
const stats = routingTopologyStats({ nodeCount: osm.nodes.size, ways: () => osm.ways }, filter);
```

### Algorithms

| Algorithm       | Optimal? | Search                                                            |
| --------------- | -------- | ----------------------------------------------------------------- |
| `dijkstra`      | Yes      | Expands in all directions from the start                          |
| `astar`         | Yes      | Guided toward the end by straight-line distance (default)         |
| `bidirectional` | Yes      | Dijkstra from both ends; the backward half follows incoming edges |

For the `time` metric, A* divides the straight-line distance by `graph.maxSpeedMps`, so the heuristic stays admissible when a `maxspeed` is above 130 km/h. `bidirectional` builds an index of incoming edges on its first use (4 bytes for each node plus 8 bytes for each edge).

A custom algorithm has the `RoutingAlgorithmFn` signature. Its last argument, `RoutingAlgorithmContext`, carries `reverseGraph` and `maxSpeedMps`.

## Limitations

The router reads only the `highway`, `oneway`, `junction` and `maxspeed` tags. It does not model:

- Turn restrictions (relations)
- Access tags (`access`, `motor_vehicle`, `foot`, `bicycle` and more)
- Mode-specific, conditional or lane-specific one-way tags
- Turn costs or elevation
- A bicycle profile (`defaultPedestrianFilter` includes cycleways)

Memory and search:

- The graph uses 16 bytes for each directed edge, plus about 4.25 bytes for each node in the dataset, routable or not. The build reads the routable ways twice and writes straight into these arrays, so its peak is the final size plus one 4-byte cursor for each node.
- Node, edge and way indexes are `Uint32`. Distances and times are `Float32`.
- A search has no distance or time limit, and you cannot cancel it. If no route exists, the search examines the whole connected network before it returns `null`.
- The worker keeps one graph (one filter) for each dataset.

See [docs/limits.md](../../docs/limits.md#router-limits) for measured graph sizes.

## Related Packages

- [`@osmix/core`](../core/README.md) - In-memory OSM index with spatial queries.
- [`@osmix/load`](../load/README.md) - Load PBF data into `Osm` indexes (`fromPbf`).
- [`@osmix/shared`](../shared/README.md) - Haversine distance and coordinate utilities.
- [`osmix`](../osmix/README.md) - High-level API with worker support for routing.

## Development

- `pnpm run test packages/router`
- `pnpm run lint packages/router`
- `pnpm run typecheck packages/router`

Run `pnpm run check` at the repo root before publishing to ensure formatting, lint, and type coverage.
