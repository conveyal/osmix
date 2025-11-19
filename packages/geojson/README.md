# @osmix/geojson

`@osmix/geojson` bridges the Osmix data model and GeoJSON. It converts `Osm`
entities into GeoJSON Features (with all tags preserved) and can build a fresh
`Osm` index directly from a GeoJSON `FeatureCollection`.

## Installation

```sh
bun install @osmix/geojson
```

## Usage

### Convert entities to GeoJSON

```ts
import { nodeToFeature, wayToFeature, relationToFeature } from "@osmix/geojson"

const nodeFeature = nodeToFeature(osm.nodes.get({ id: 1 })!)
const wayFeature = wayToFeature(osm.ways.get({ id: 10 })!, (ref) =>
	osm.nodes.getNodeLonLat({ id: ref }),
)
const relationFeature = relationToFeature(
	osm.relations.get({ id: 50 })!,
	(ref) => osm.nodes.getNodeLonLat({ id: ref }),
	(wayId) => osm.ways.getById(wayId),
)
```

### Build an `Osm` index from GeoJSON

```ts
import { createOsmFromGeoJSON } from "@osmix/geojson"
import type { FeatureCollection } from "geojson"

const geojsonFile = await Bun.file('./roads.geojson').json()
const osm = createOsmFromGeoJSON(geojsonFile, { id: "demo" })
```

`createOsmFromGeoJSON` handles `Point`, `LineString`, `Polygon`, and
`MultiPolygon` geometries. When polygons contain holes, the helper automatically
creates a multipolygon relation where the outer ring and each hole are
represented by individual ways.

## API 

WIP

## Environment and limitations

- Requires runtimes that support standard `Map`/`Set`, typed arrays, and
  `ReadableStream`/`TextDecoder` if you plan to load GeoJSON via `Osmix`.
- Relation helpers currently focus on multipolygon relations; other relation
  types are converted to simple MultiPolygons made from member order.

## Development

- `bun run test packages/geojson`
- `bun run lint packages/geojson`
- `bun run typecheck packages/geojson`

Run `bun run check` at the repo root before publishing to ensure formatting,
lint, and type coverage.