---
"@osmix/pbf": patch
---

`PbfWriter.writePackedVarint` throws for values that do not fit in a varint (`Infinity`, 2^64 and up), as `writeVarint` does. Before, `Infinity` looped forever and 2^64 and up wrote past the bytes the writer had reserved.
