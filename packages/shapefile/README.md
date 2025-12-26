# @osmix/shapefile

Import Shapefiles into Osmix indexes.

## Installation

```bash
npm install @osmix/shapefile
```

## Usage

```ts
import { fromShapefile } from "@osmix/shapefile"

// From a ZIP file buffer
const zipBuffer = await Bun.file("./buildings.zip").arrayBuffer()
const osm = await fromShapefile(zipBuffer, { id: "buildings" })

// From a URL
const osm = await fromShapefile("https://example.com/data.zip")

// Query the imported data
const buildings = osm.ways.search("building")
```

## How It Works

This package uses [shpjs](https://github.com/calvinmetcalf/shapefile-js) to parse Shapefiles.
The library automatically:

- Extracts Shapefile components (`.shp`, `.dbf`, `.prj`) from ZIP archives
- Projects coordinates to WGS84 (lat/lon)
- Converts geometries to GeoJSON

The GeoJSON is then converted to OSM entities:

| Shapefile Geometry | OSM Entity                          |
| ------------------ | ----------------------------------- |
| Point              | Node                                |
| MultiPoint         | Multiple Nodes                      |
| PolyLine           | Way                                 |
| Polygon            | Way (simple) or Relation (w/ holes) |
| MultiPolygon       | Relation                            |

DBF attributes become OSM tags.

## API

### `fromShapefile(data, options?, onProgress?)`

Create an Osm index from Shapefile data.

**Parameters:**

- `data` - URL string or ArrayBuffer containing a ZIP file
- `options` - Optional Osm options (`{ id?: string }`)
- `onProgress` - Optional progress callback

**Returns:** `Promise<Osm>` - Populated Osm index with built indexes

## License

MIT
