---
"osmix": minor
---

Add `OsmixRemote.copy(fromId, toId)`, which registers a dataset under a second ID in every worker while keeping the original. SharedArrayBuffer-backed datasets share their buffers, so the copy is free, and replacing or deleting one ID leaves the other intact.
