---
"@osmix/change": minor
"osmix": minor
---

**Breaking:** an `OsmChangeset`'s `nodeChanges`, `wayChanges` and `relationChanges` (`OsmChangeRecords`) are `ChangeRecordTable`s instead of plain objects keyed by ID: read a record with `get(id)`, and iterate with `keys()` and `values()`, which keep the order the objects had. This lets merge plans read untouched imported entities from the patch instead of storing a record for each.
