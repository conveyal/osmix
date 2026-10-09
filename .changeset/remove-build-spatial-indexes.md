---
"@osmix/load": minor
"osmix": minor
"@osmix/cli": patch
---

**Breaking:** remove the deprecated `buildSpatialIndexes` load option. Choose spatial indexes with `loadProfile` (`"auto"`, `"full"`, or `"view"`) or, for an exact selection, `spatialIndexes`. For example, `buildSpatialIndexes: ["way", "relation"]` becomes `spatialIndexes: { nodes: [], ways: true, relations: true }`.
