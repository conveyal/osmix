---
"@osmix/core": patch
---

Way and relation `neighbors` queries use a typed port of `geoflatbush`'s `around` search instead of depending on `geoflatbush`. Results are unchanged.
