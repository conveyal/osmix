---
"@osmix/change": minor
"osmix": minor
---

Matching proposals list `competitors`: proposals from other imported features that cannot apply with them (connections to one base node; copies and removals against one base way). Decisions that include two alternatives or two competitors throw `MergePlanDecisionConflictError`, which names both proposals and the imported points, and `setMergePlanDecisions` now leaves the plan unchanged whenever it throws. Bulk include skips competitors and never includes a way removal.
