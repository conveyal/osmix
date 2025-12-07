# @osmix/geojson

Bidirectional conversion between OSM entities and GeoJSON. Export `Osm` entities as GeoJSON Features (preserving all tags) or import GeoJSON FeatureCollections into a fresh `Osm` index.

## Highlights

- **Export** nodes, ways, and relations to typed GeoJSON Features.
- **Import** Point, LineString, Polygon, and MultiPolygon features into Osm indexes.
- **Preserve** OSM tags and metadata in GeoJSON properties.
- **Handle** complex geometries like multipolygons with holes automatically.

## Installation

```sh
bun add @osmix/geojson
```

## Usage

### Export entities to GeoJSON

```ts
import { nodeToFeature, wayToFeature, relationToFeature } from "@osmix/geojson"

// Convert individual entities
const nodeFeature = nodeToFeature(osm.nodes.get({ id: 1 })!)
const wayFeature = wayToFeature(
	osm.ways.get({ id: 10 })!,
	(ref) => osm.nodes.getNodeLonLat({ id: ref })
)
const relationFeature = relationToFeature(
	osm.relations.get({ id: 50 })!,
	(ref) => osm.nodes.getNodeLonLat({ id: ref }),
	(wayId) => osm.ways.getById(wayId)
)
```

### Export using the helper function

```ts
import { osmEntityToGeoJSONFeature } from "@osmix/geojson"

// Convert any entity type with automatic coordinate resolution
const features = []
for (const way of osm.ways) {
	features.push(osmEntityToGeoJSONFeature(osm, way))
}

const featureCollection = {
	type: "FeatureCollection",
	features,
}
```

### Import GeoJSON to Osm

```ts
import { fromGeoJSON } from "@osmix/geojson"

const geojsonFile = await Bun.file('./roads.geojson').json()
const osm = await fromGeoJSON(geojsonFile, { id: "roads" })

// Query imported data
const highways = osm.ways.search("highway")
console.log(`Imported ${osm.ways.size} ways`)
```

`fromGeoJSON` handles `Point`, `LineString`, `Polygon`, and `MultiPolygon` geometries. Polygons with holes automatically create multipolygon relations with separate ways for outer and inner rings.

## API

### Export (OSM → GeoJSON)

| Export | Description |
|--------|-------------|
| `nodeToFeature(node)` | Node → Point Feature |
| `wayToFeature(way, refToPosition)` | Way → LineString or Polygon Feature |
| `relationToFeature(relation, refToPosition, getWay?)` | Relation → Multi* or GeometryCollection |
| `osmEntityToGeoJSONFeature(osm, entity)` | Any entity → Feature with auto coordinate resolution |

### Import (GeoJSON → OSM)

| Export | Description |
|--------|-------------|
| `fromGeoJSON(data, options?, onProgress?)` | Create Osm index from GeoJSON |
| `startCreateOsmFromGeoJSON(osm, geojson)` | Generator for custom progress handling |

### Types

| Export | Description |
|--------|-------------|
| `OsmGeoJSONFeature<T>` | GeoJSON Feature with OSM properties |
| `OsmGeoJSONProperties` | Properties type (id, type, tags, info) |
| `ImportableGeoJSON` | FeatureCollection types supported for import |
| `ReadOsmDataTypes` | Input types for `fromGeoJSON` |

## Geometry Mapping

| OSM Entity | GeoJSON Geometry |
|------------|------------------|
| Node | Point |
| Way (linear) | LineString |
| Way (area) | Polygon |
| Relation (multipolygon) | MultiPolygon or Polygon |
| Relation (route) | MultiLineString or LineString |
| Relation (site) | MultiPoint or Point |
| Relation (other) | GeometryCollection |

## Related Packages

- [`@osmix/core`](../core/README.md) – In-memory OSM storage these features convert from/to.
- [`@osmix/json`](../json/README.md) – JSON entity types used in conversion.
- [`@osmix/pbf`](../pbf/README.md) – PBF reading/writing for complete workflows.

## Environment and Limitations

- Requires `Map`/`Set`, typed arrays, and `ReadableStream`/`TextDecoder` (Bun, Node 20+, modern browsers).
- Import supports Point, LineString, Polygon, MultiPolygon only.
- Relation export focuses on multipolygon/route relations; other types return GeometryCollection.

## Development

```sh
bun run test packages/geojson
bun run lint packages/geojson
bun run typecheck packages/geojson
```

Run `bun run check` at the repo root before publishing.