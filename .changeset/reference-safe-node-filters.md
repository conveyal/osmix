---
"@osmix/types": minor
"@osmix/load": minor
"osmix": minor
---

Make node tag filters safe for routing. Node rules now select only standalone nodes: a tag-filtered load keeps every node that a kept way or relation references, and `pruneUnreferencedNodes` drops the rest after ingestion. `CONVEYAL_EXTRACT_TAG_FILTERS` now keeps only `park_ride` standalone nodes, which makes R5 extracts much smaller. Extracts never remove members from a turn restriction: `simple` and `complete_ways` drop a restriction the bbox cuts, and `smart` completes it. Adds `isRestrictionRelation`.
