# osm.ts
OpenStreetMap reader, writer, and merge tool. Written in TypeScript.

## Features
- [Native Decompression and Compression](https://developer.mozilla.org/en-US/docs/Web/API/Compression_Streams_API)
- [@mapbox/pbf](https://github.com/mapbox/pbf) for decoding and encoding protocol buffers.
- TypeScript.
- Low-level stream reading and writing functions for usage with larger datasets.
- Convert entities to GeoJSON.