---
"@osmix/core": patch
"osmix": patch
---

Reuse built way and relation spatial indexes. `Ways.buildSpatialIndex()` and `Relations.buildSpatialIndex()` rebuilt their Flatbush trees on every call, so calling `Osm.buildSpatialIndexes()` on a loaded dataset repeated work. They now return the existing index, as node indexes already did.
