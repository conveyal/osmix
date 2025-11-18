# @osmix/geojson

`@osmix/geojson` bridges the Osmix data model and GeoJSON. It converts `Osm`
entities into GeoJSON Features (with all tags preserved) and can build a fresh
`Osm` index directly from a GeoJSON `FeatureCollection`.

## Highlights

- Zero-copy helpers (`nodeToFeature`, `wayToFeature`, `relationToFeature`) that
  emit GeoJSON with normalized winding order and metadata passthrough.
- `osmEntityToGeoJSONFeature(osm, entity)` resolves coordinates via an existing
  `Osm` instance so downstream tooling does not have to look up refs manually.
- `createOsmFromGeoJSON` / `startCreateOsmFromGeoJSON` ingest FeatureCollections,
  reuse nodes when coordinates repeat, and create relations for polygons with
  holes or multipolygons.

## Installation

```sh
npm install @osmix/geojson
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

Need a one-liner that figures out which helper to call? Use
`osmEntityToGeoJSONFeature(osm, entity)`.

### Build an `Osm` index from GeoJSON

```ts
import { createOsmFromGeoJSON } from "@osmix/geojson"
import type { FeatureCollection } from "geojson"

const geojson: FeatureCollection = await fetch("/demo.geojson").then((r) =>
	r.json(),
)

const osm = createOsmFromGeoJSON(geojson, { id: "demo" })
```

`createOsmFromGeoJSON` handles `Point`, `LineString`, `Polygon`, and
`MultiPolygon` geometries. When polygons contain holes, the helper automatically
creates a multipolygon relation where the outer ring and each hole are
represented by individual ways.

When you need progress updates or want to interleave other work, switch to the
generator variant:

```ts
import { startCreateOsmFromGeoJSON } from "@osmix/geojson"
import { Osm } from "@osmix/core"

const osm = new Osm({ id: "demo" })
for (const progress of startCreateOsmFromGeoJSON(osm, geojson)) {
	console.log(progress.message)
}
```

## API overview

- `nodeToFeature(node)` / `wayToFeature(way, refToPosition)` /
  `relationToFeature(relation, refToPosition, getWay?)`
- `osmEntityToGeoJSONFeature(osm, entity)`
- `createOsmFromGeoJSON(geojson, options?, onProgress?)`
- `startCreateOsmFromGeoJSON(osm, geojson)` – generator that yields
  `ProgressEvent`s while mutating the provided `Osm` instance.
- Types (`OsmGeoJSONFeature`, etc.) for downstream consumers.

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