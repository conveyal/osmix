---
"@osmix/shared": patch
"@osmix/core": minor
"@osmix/load": minor
"@osmix/vt": patch
"@osmix/shortbread": patch
"osmix": minor
---

Enable memory-aware loading of Australia-scale PBF data. Core storage and transfers now use the compact
version 2 representation, node spatial queries use independent indirect all-node and tagged-node indexes, and
loaders expose Auto, Full, View, and explicit spatial-index selection with structured capacity diagnostics.
Vector-tile encoders use the tagged-node capability without requiring an all-node index.
