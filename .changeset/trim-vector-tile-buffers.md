---
"@osmix/vt": patch
"osmix": patch
---

Return only the encoded bytes from `writeVtPbf`. It returned the writer's whole backing buffer, so every vector tile ended with unused zero bytes, sometimes nearly doubling its size.
