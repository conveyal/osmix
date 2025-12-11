---
"@osmix/change": minor
---

Add augmented diffs support following the Overpass API Augmented Diffs format.

- `OsmChange` type now includes an optional `oldEntity` field that captures the previous state of an entity for "modify" and "delete" operations
- `generateOscChanges()` now defaults to producing augmented diffs with `<old>` and `<new>` sections for modifications, and `<old>` sections for deletions
- Added `OscOptions.augmented` option to control whether augmented diffs are generated (defaults to `true`)
- Updated merge app UI to display side-by-side old/new comparison for modifications
