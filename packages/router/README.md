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

WIP

## Development

- `bun run test packages/router`
- `bun run lint packages/router`
- `bun run typecheck packages/router`

Run `bun run check` at the repo root before publishing to ensure formatting, lint, and type coverage.

