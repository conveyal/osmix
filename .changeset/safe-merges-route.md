---
"@osmix/change": patch
"@osmix/router": patch
"osmix": patch
---

Preserve input topology during merges, conservatively reconcile compatible patch entities with the base,
validate routing-sensitive references, and insert multiple intersections in way order. Within-file duplicate
scans in the Merge app are now diagnostic only; regenerate older merged PBFs from their source inputs. Correct
the router priority queue so shortest-path searches visit lower-cost states first, and honor the one-way
direction implied by OSM roundabouts plus reverse one-way (`oneway=-1`) tags.
