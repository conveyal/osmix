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

Restore the original 1-meter matching behavior as explicit, cross-dataset fuzzy conflation for imported data.
Callers select transferable properties independently from patch-network attachment; exact merge behavior
remains the default. Unique, high-confidence pedestrian and one-to-one-way matches can apply automatically,
while routing properties, motor roads, ambiguity, relation involvement, and uncertain geometry require review.
Grade conflicts, restrictions, protected tags, dangling references, way collapse, and base-topology rewrites
remain blocked. Add public candidate/evidence/decision APIs, restart-safe worker review sessions, CAR/WALK
topology diagnostics, and a dedicated Merge-app review step.
