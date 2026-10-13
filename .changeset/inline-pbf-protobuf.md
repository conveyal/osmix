---
"@osmix/pbf": minor
"@osmix/vt": patch
---

`@osmix/pbf` has no runtime dependencies: its protobuf reader and writer are now a typed port of `pbf` 5.1.2's `PbfReader` and `PbfWriter`, exported from the new `@osmix/pbf/protobuf` entry. They write the same bytes as `pbf`. `@osmix/vt` encodes vector tiles with it instead of depending on `pbf`, which drops `pbf`, `resolve-protobuf-schema` and `protocol-buffers-schema` from installs.
