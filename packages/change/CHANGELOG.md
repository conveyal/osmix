# @osmix/change

## 0.1.5

### Patch Changes

- 3c8ee95: Fix and simplify package exports
- Updated dependencies [3c8ee95]
  - @osmix/core@0.1.6
  - @osmix/shared@0.0.11

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

- 2944218: Add augmented diffs support following the Overpass API Augmented Diffs format.

  - `OsmChange` type now includes an optional `oldEntity` field that captures the previous state of an entity for "modify" and "delete" operations
  - `generateOscChanges()` now defaults to producing augmented diffs with `<old>` and `<new>` sections for modifications, and `<old>` sections for deletions
  - Added `OscOptions.augmented` option to control whether augmented diffs are generated (defaults to `true`)
  - Updated merge app UI to display side-by-side old/new comparison for modifications

### Patch Changes

- 4b91a34: Bump sweepline-intersections from 1.5.0 to 2.0.1
- 2944218: Export Augmented Diffs
- Updated dependencies [d4f4b1f]
  - @osmix/core@0.1.1

## 0.0.7

### Patch Changes

- ff40416: Refactor main `osmix` lib external APIs
- Updated dependencies [803c05c]
- Updated dependencies [cbe4273]
- Updated dependencies [ff40416]
- Updated dependencies [29ed376]
  - @osmix/core@0.1.0

## 0.0.6

### Patch Changes

- 3846a0c: Integrate geographic spatial indexing libraries
- Updated dependencies [3846a0c]
- Updated dependencies [0cd8a2e]
- Updated dependencies [cdab4db]
  - @osmix/core@0.0.6
  - @osmix/shared@0.0.6

## 0.0.5

### Patch Changes

- 345b716: Move functionality outside of the Changeset
- 69a36bd: Switch Nodes coordinate storage to Int32Array
- Updated dependencies [bb629cf]
- Updated dependencies [a33a280]
- Updated dependencies [edbb26b]
- Updated dependencies [69a36bd]
  - @osmix/shared@0.0.5
  - @osmix/core@0.0.5

## 0.0.4

### Patch Changes

- d001d9a: Refactor to align around new main external API
- 4303c40: Refactor core Osmix index to prepare for future work
- Updated dependencies [572cbd8]
- Updated dependencies [d001d9a]
- Updated dependencies [4303c40]
  - @osmix/shared@0.0.4
  - @osmix/core@0.0.4

## 0.0.3

### Patch Changes

- Updated dependencies [b4a3ff2]
- Updated dependencies [c0193dd]
  - @osmix/shared@0.0.3
  - @osmix/core@0.0.3
  - @osmix/json@0.0.3
  - @osmix/pbf@0.0.2

## 0.0.2

### Patch Changes

- 33d9c12: Modify types to take Uint8Array<ArrayBufferLike> for compatiblity
- Updated dependencies [33d9c12]
  - @osmix/shared@0.0.2
  - @osmix/core@0.0.2
  - @osmix/json@0.0.2
  - @osmix/pbf@0.0.2

## 0.0.1

### Patch Changes

- Initial release
- Updated dependencies
  - @osmix/core@0.0.1
  - @osmix/json@0.0.1
  - @osmix/pbf@0.0.1
  - @osmix/shared@0.0.1
