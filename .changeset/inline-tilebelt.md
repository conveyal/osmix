---
"@osmix/geo": patch
---

`pointToTileFraction` is now implemented in `@osmix/geo/tile` instead of re-exported from `@mapbox/tilebelt`, which is no longer a runtime dependency. It returns the same values.
