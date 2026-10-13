---
"@osmix/geo": patch
---

`@osmix/geo/lineclip` is now a typed port of `lineclip` 2.0.0 instead of a re-export, so `lineclip` is no longer a runtime dependency. `clipPolyline` and `clipPolygon` return the same results.
