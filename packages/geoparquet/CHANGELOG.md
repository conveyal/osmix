# @osmix/geoparquet

## 0.1.4

### Patch Changes

- Updated dependencies [12728ed]
  - @osmix/shared@0.0.10
  - @osmix/core@0.1.5

## 0.1.3

### Patch Changes

- f32e4ee: General cleanup
- Updated dependencies [f32e4ee]
  - @osmix/core@0.1.4
  - @osmix/shared@0.0.9

## 0.1.2

### Patch Changes

- f468db5: Fix publishing (2)
- Updated dependencies [f468db5]
  - @osmix/core@0.1.3
  - @osmix/shared@0.0.8

## 0.1.1

### Patch Changes

- 68d6bd8: Fix publishing for packages.
- Updated dependencies [68d6bd8]
  - @osmix/core@0.1.2
  - @osmix/shared@0.0.7

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
