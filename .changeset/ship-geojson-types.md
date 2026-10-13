---
"@osmix/geo": patch
"@osmix/change": patch
"@osmix/geojson": patch
"@osmix/geoparquet": patch
"@osmix/shapefile": patch
---

`@types/geojson` is now a dependency instead of a devDependency of the packages whose published type declarations import `geojson`, so TypeScript consumers no longer have to install it themselves.
