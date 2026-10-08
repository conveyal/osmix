---
"@osmix/change": patch
"osmix": patch
---

Planning a large import uses much less memory: the crossings phase caches only pairs of ways that cross, unmatched matching candidates share their empty assessments, and the structures built to search the planned state are freed when a plan or replan finishes and before `applyPlan`. Planning Washington's 1.48M-entity sidewalk import drops from 6.5 GB to 4.0 GB of heap.
