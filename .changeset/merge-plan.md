---
"@osmix/change": minor
"osmix": minor
---

Merges are now planned once and applied once. `planMerge(base, patch, options)` records every change as a proposal grouped by imported feature; `setMergePlanDecisions` accepts or rejects proposals and replans only the affected phases; `applyPlan` builds the result in a single pass; `generateMergePlanOsc` writes the plan as osmChange.

**Breaking:** `merge()` now plans and applies with the Merge app's defaults: imported points at identical coordinates merge into the base, imported ways connect where they cross, and matching runs only when configured. Its options are `MergePlanOptions`:

| Before (`OsmMergeOptions`)                     | After (`MergePlanOptions`)                        |
| ---------------------------------------------- | ------------------------------------------------- |
| `directMerge: true`                            | Always on                                         |
| `deduplicateNodes`, `deduplicateWays`          | `mergeIdenticalPoints` (default `true`)           |
| `createIntersections`                          | `createIntersections` (default `true`)            |
| `conflation: { ..., decisions }`               | `matching: { ... }` plus `decisions` on proposals |
| `merge(base, patch)` returned `base` unchanged | `merge(base, patch)` runs the default plan        |

Negative patch IDs are new features and move below the base's lowest ID, so independent imports no longer collide; positive patch IDs still edit the base entity with that ID. `patchIds: "new"` reads every patch ID as new.
