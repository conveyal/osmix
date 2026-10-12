---
"@osmix/change": minor
"osmix": minor
---

**Breaking:** an `OsmChangeset`'s `nodeChanges`, `wayChanges` and `relationChanges` (`OsmChangeRecords`) are `ChangeRecordTable`s instead of plain objects keyed by ID: read a record with `get(id)`, and iterate with `keys()` and `values()`, which keep the order the objects had. This lets merge plans read untouched imported entities from the patch instead of storing a record for each.

Merge plans of large imports use far less memory (Washington's 1.48M-entity import: 2.9 GB peak in Node, from 5.3 GB) and plan faster, with the same output. Empty lists in a matching outcome report (`copiedKeys`, `connectedWayIds`, `reasons`) are one shared frozen array: copy a list before changing it.
