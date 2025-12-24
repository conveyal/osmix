# @osmix/shapefile

Import Shapefiles into Osmix indexes. Parse ZIP archives containing Shapefile components (.shp, .shx, .dbf) and convert them to OSM entities.

## Highlights

- **Import** Point, Polyline, Polygon, and MultiPoint shapes into Osm indexes.
- **Preserve** Shapefile attributes (from .dbf) as OSM tags.
- **Handle** complex geometries like polygons with holes automatically.
- **Multiple shapefiles** in a single ZIP archive are all imported.

## Installation

```sh
bun add @osmix/shapefile
```

## Usage

### Import Shapefile to Osm

```ts
import { fromShapefile } from "@osmix/shapefile"

const zipBuffer = await Bun.file('./buildings.zip').arrayBuffer()
const osm = await fromShapefile(zipBuffer, { id: "buildings" })

// Query imported data
const buildings = osm.ways.search("building")
console.log(`Imported ${osm.ways.size} ways`)
```

### From fetch response

```ts
import { fromShapefile } from "@osmix/shapefile"

const response = await fetch('/data/parcels.zip')
const osm = await fromShapefile(await response.arrayBuffer())
```

### With progress callback

```ts
import { fromShapefile } from "@osmix/shapefile"

const osm = await fromShapefile(zipBuffer, { id: "data" }, (progress) => {
  console.log(progress.message)
})
```

## API

### Import (Shapefile → OSM)

| Export | Description |
|--------|-------------|
| `fromShapefile(data, options?, onProgress?)` | Create Osm index from Shapefile ZIP |
| `startCreateOsmFromShapefile(osm, shapefile, name)` | Generator for custom progress handling |

### Types

| Export | Description |
|--------|-------------|
| `ReadShapefileDataTypes` | Input types for `fromShapefile` |

## Geometry Mapping

| Shapefile Type | OSM Entity |
|----------------|------------|
| Point | Node |
| PointZ, PointM | Node |
| MultiPoint | Multiple Nodes |
| Polyline | Way (LineString) |
| PolylineZ, PolylineM | Way |
| Polygon (single ring) | Way |
| Polygon (with holes) | Relation (multipolygon) |
| PolygonZ, PolygonM | Way or Relation |

## Shapefile Format

Shapefiles must be provided as ZIP archives containing at minimum:
- `.shp` - Shape geometry
- `.shx` - Shape index
- `.dbf` - Attribute data (dBase format)

Optional files like `.prj` (projection) and `.cpg` (code page) are also supported by the underlying parser.

## Related Packages

- [`@osmix/core`](../core/README.md) – In-memory OSM storage these features import to.
- [`@osmix/geojson`](../geojson/README.md) – GeoJSON import/export (similar functionality).
- [`@osmix/pbf`](../pbf/README.md) – PBF reading/writing for complete workflows.

## Environment and Limitations

- Requires `ArrayBuffer`, typed arrays, and async/await (Bun, Node 20+, modern browsers).
- Import supports Point, Polyline, Polygon, MultiPoint shape types.
- Z and M variants are supported (Z/M values are currently ignored).
- Uses [shapefile.js](https://github.com/matthewdowns/shapefile.js) for parsing.

## Development

```sh
bun run test packages/shapefile
bun run lint packages/shapefile
bun run typecheck packages/shapefile
```

Run `bun run check` at the repo root before publishing.
