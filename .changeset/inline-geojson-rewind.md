---
"@osmix/geo": minor
"@osmix/geojson": patch
"@osmix/geoparquet": patch
"@osmix/raster": patch
"@osmix/shapefile": patch
---

Polygon winding now comes from the new `@osmix/geo/rewind` module (`rewindRing`, `rewindGeometry`, `rewindFeature`) instead of `@placemarkio/geojson-rewind`. That package lists `@changesets/cli` as a runtime dependency, so installing `@osmix/geojson`, `@osmix/geoparquet`, `@osmix/raster`, `@osmix/shapefile` or `osmix` no longer installs about 155 unneeded packages.
