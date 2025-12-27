---
"@osmix/geoparquet": minor
---

Add `@osmix/geoparquet` package for importing OSM data from OpenStreetMap US Layercake GeoParquet files.

Features:
- `fromGeoParquet()` function to create Osm indexes from GeoParquet files
- WKB geometry parsing for Point, LineString, Polygon, and MultiPolygon
- Support for file paths, URLs, and ArrayBuffer inputs
- Customizable column mapping for different parquet schemas
