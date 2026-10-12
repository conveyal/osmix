---
"@osmix/change": minor
"osmix": minor
---

**Breaking:** `plan.diagnostics.integrity` lists `PlanIntegrityIssue` objects, each with its `description` and the `entities` it names (planned IDs), instead of strings. A merge plan overview adds the `featureKey` of the imported feature each issue concerns, when there is one.
