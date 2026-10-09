---
"@osmix/load": patch
---

PBF exports record `osmosis_replication_timestamp` in seconds since the epoch, as the PBF format defines it, instead of milliseconds. Files exported by earlier versions carry a millisecond value.
