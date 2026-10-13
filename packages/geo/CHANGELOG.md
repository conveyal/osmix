# @osmix/geo

## 0.2.0

### Minor Changes

- Polygon winding now comes from the new `@osmix/geo/rewind` module (`rewindRing`, `rewindGeometry`, `rewindFeature`) instead of `@placemarkio/geojson-rewind`. That package lists `@changesets/cli` as a runtime dependency, so installing `@osmix/geojson`, `@osmix/geoparquet`, `@osmix/raster`, `@osmix/shapefile` or `osmix` no longer installs about 155 unneeded packages.

### Patch Changes

- `@osmix/geo/lineclip` is now a typed port of `lineclip` 2.0.0 instead of a re-export, so `lineclip` is no longer a runtime dependency. `clipPolyline` and `clipPolygon` return the same results.

- `pointToTileFraction` is now implemented in `@osmix/geo/tile` instead of re-exported from `@mapbox/tilebelt`, which is no longer a runtime dependency. It returns the same values.

- `@types/geojson` is now a dependency instead of a devDependency of the packages whose published type declarations import `geojson`, so TypeScript consumers no longer have to install it themselves.

- Publish `main` and `types` pointing at the built entry module instead of a missing `./dist/index.js`.

- Updated dependencies:
  - @osmix/types@0.3.0

## 0.1.1

### Patch Changes

- Updated dependencies [466adc0]
- Updated dependencies [66eb7cd]
  - @osmix/types@0.2.0

## 0.1.0

### Minor Changes

- 368d103: Introduce focused packages extracted from `@osmix/shared`.

### Patch Changes

- Updated dependencies [368d103]
  - @osmix/types@0.1.0
