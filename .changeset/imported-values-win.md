---
"@osmix/change": minor
"osmix": minor
---

**Breaking:** imported values win every merge that makes two features one (T24), not only node merges:

- An exact way reconciliation takes the imported way's values, `name` and routing tags included, and keeps the keys only the base way has. A difference in `surface`, `width`, access or direction no longer keeps the imported way; both ways must still be highways or not, areas or not, and the imported direction supported. An equivalent `oneway` spelling keeps the base's. A reconcile that would change the base way's grade is a review proposal with reason `grade-change` that no automation level decides (MP-X2).
- A connection merges the imported point's tags into the base node, as an identical-point merge does, and drops the point once nothing references it. Access, barrier and other node routing differences no longer block it; a change of the base node's grade is a review proposal (`grade-change`) (MP-M3).
- Two connections to one base node whose points give a key different values compete: each waits for a person with reason `node-context-conflict`, and `connectionRivals` and plan `rivalries` name the keys (`conflictingKeys`; `sharedWayId` and `sharedWay` are now optional) (MP-M5).
- The matching outcome credits values a connection writes as copied, and `removedConnectionOrphanNodes` counts tagged points a connection merged.

Within one dataset (Inspect's duplicate scan) both sides must still agree, and copying routing keys still needs review.
