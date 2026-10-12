---
"osmix": minor
---

Add `OsmixRemote.extract(sourceId, options)`, which extracts a bounding box from a dataset already loaded in the workers into a new dataset. The bbox, strategy and tag filters behave exactly as the `fromPbf` extract options, and the source is left as it is.
