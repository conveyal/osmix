---
"@osmix/core": minor
"osmix": minor
---

**Breaking:** `Osm.bbox()` and `OsmInfo.bbox` are `null` for a dataset with no nodes.

Add `renumberNegativeIds` and `negativeIdMap`, which renumber new (negative) IDs after each entity type's highest ID for tools that reject negative IDs, with every way ref and relation member following. Ways, relations and strings beyond what the stored format holds (65,535 refs, members or bytes) now throw `OsmCapacityError`, which names the entity and the limit; the limits and `assertCapacity` are exported. `ResizeableTypedArray` is exported.
