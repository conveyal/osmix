# @osmix/cli

## 0.0.3

### Patch Changes

- Updated dependencies:
  - @osmix/geo@0.2.0
  - @osmix/shortbread@0.1.1
  - osmix@0.4.1

## 0.0.2

### Patch Changes

- 9ec9dbc: Add an OpenTUI Three.js WebGPU vector backend, with terminal-pixel output through Kitty Graphics or
  Sixel when supported, while retaining quadrant and raster compatibility fallbacks. The
  `OSMIX_CLI_RENDERER` environment variable selects or requires a backend.
- 66eb7cd: **Breaking:** remove the deprecated `buildSpatialIndexes` load option. Choose spatial indexes with `loadProfile` (`"auto"`, `"full"`, or `"view"`) or, for an exact selection, `spatialIndexes`. For example, `buildSpatialIndexes: ["way", "relation"]` becomes `spatialIndexes: { nodes: [], ways: true, relations: true }`.
- 891dd68: Add the interactive `osmix` terminal map viewer and standalone release executables.
- Updated dependencies [303ca75]
- Updated dependencies [e123e58]
- Updated dependencies [e4785fe]
- Updated dependencies [df04f92]
- Updated dependencies [66eb7cd]
- Updated dependencies [e4785fe]
- Updated dependencies [66eb7cd]
- Updated dependencies [66eb7cd]
- Updated dependencies [66eb7cd]
- Updated dependencies [66eb7cd]
- Updated dependencies [9b63b65]
- Updated dependencies [61de06c]
- Updated dependencies [66eb7cd]
- Updated dependencies [66eb7cd]
- Updated dependencies [66eb7cd]
- Updated dependencies [66eb7cd]
- Updated dependencies [66eb7cd]
- Updated dependencies [66eb7cd]
- Updated dependencies [66eb7cd]
- Updated dependencies [66eb7cd]
- Updated dependencies [466adc0]
- Updated dependencies [66eb7cd]
- Updated dependencies [c269e52]
- Updated dependencies [5ea11cf]
- Updated dependencies [66eb7cd]
- Updated dependencies [66eb7cd]
- Updated dependencies [66eb7cd]
- Updated dependencies [66eb7cd]
- Updated dependencies [6978796]
- Updated dependencies [66eb7cd]
- Updated dependencies [8be5c80]
- Updated dependencies [cd987f5]
- Updated dependencies [66eb7cd]
- Updated dependencies [66eb7cd]
- Updated dependencies [66eb7cd]
- Updated dependencies [66eb7cd]
- Updated dependencies [66eb7cd]
  - osmix@0.4.0
  - @osmix/shared@0.2.0
  - @osmix/shortbread@0.1.0
  - @osmix/geo@0.1.1
