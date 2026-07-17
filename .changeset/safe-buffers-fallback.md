---
"@osmix/core": patch
"@osmix/geojson": patch
"@osmix/router": patch
"@osmix/shapefile": patch
"@osmix/shared": patch
"osmix": patch
---

Allow Osmix to use its ArrayBuffer fallback when SharedArrayBuffer is unavailable, so browser
applications no longer need to install a global SharedArrayBuffer shim.
