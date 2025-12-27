# @osmix/geoparquet

## 0.1.0

### Minor Changes

- 31fa333: Add `@osmix/geoparquet` package for importing OSM data from OpenStreetMap US Layercake GeoParquet files.

  Features:

  - `fromGeoParquet()` function to create Osm indexes from GeoParquet files
  - WKB geometry parsing for Point, LineString, Polygon, and MultiPolygon
  - Support for file paths, URLs, and ArrayBuffer inputs
  - Customizable column mapping for different parquet schemas

### Patch Changes

- 54fe002: Add fromGeoParquet to OsmixWorker and OsmixRemote
- 31fa333: Import GeoParquet
- Updated dependencies [d4f4b1f]
  - @osmix/core@0.1.1
