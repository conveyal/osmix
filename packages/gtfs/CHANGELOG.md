# @osmix/gtfs

## 0.0.6

### Patch Changes

- 3c8ee95: Fix and simplify package exports
- Updated dependencies [3c8ee95]
  - @osmix/core@0.1.6
  - @osmix/shared@0.0.11

## 0.0.5

### Patch Changes

- 12728ed: Replace `csv-parse` usage in `@osmix/gtfs` with a browser-friendly shared streaming CSV parser in `@osmix/shared`, adapted from `mafintosh/csv-parser` parsing behavior.
- Updated dependencies [12728ed]
  - @osmix/shared@0.0.10
  - @osmix/core@0.1.5

## 0.0.4

### Patch Changes

- f32e4ee: General cleanup
- Updated dependencies [f32e4ee]
  - @osmix/core@0.1.4
  - @osmix/shared@0.0.9

## 0.0.3

### Patch Changes

- f468db5: Fix publishing (2)
- 536a3cd: Remove JSR dependency for CSV parsing
- Updated dependencies [f468db5]
  - @osmix/core@0.1.3
  - @osmix/shared@0.0.8

## 0.0.2

### Patch Changes

- 68d6bd8: Fix publishing for packages.
- Updated dependencies [68d6bd8]
  - @osmix/core@0.1.2
  - @osmix/shared@0.0.7

## 0.0.1

### Added

- Initial release with GTFS to OSM conversion.
- Stops parsed as nodes with tags.
- Routes parsed as ways with shape geometry.
