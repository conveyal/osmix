---
"@osmix/change": minor
"osmix": minor
---

Add `dropImportedKeys` to merge plan options: imported keys, or prefixes ending in `*`, that never reach base data. Identical-point and way merges, connections, crossing snaps and replacement anchors leave them out, and connections whose points differ only in them no longer compete; features the import adds keep them. A copy that selects a dropped key is refused (MP-X4). Merge drops `ext:*`, an OpenSidewalks export's own metadata.
