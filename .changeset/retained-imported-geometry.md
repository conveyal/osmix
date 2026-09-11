---
"@osmix/change": patch
"osmix": patch
---

Keep matched imported ways and their connecting nodes when copying selected tags onto base features. Property transfer now changes only tag values relative to the ordinary direct/exact merge, including automatic, individual, and filter-wide decisions. This prevents tag-only merges from disconnecting imported branches when network attachment is disabled. Geometry removal is no longer an implicit side effect of copying tags.
