---
"@osmix/change": patch
"osmix": patch
---

Fix a residual pre-existing exact-node reconciliation defect discovered during the PR #218 review, not introduced by that PR. Validate all proposed sources and their final survivor together before changing tags, references, or entity existence. An untagged base node can no longer absorb conflicting coincident imported cafe and school nodes and silently lose one classification.

Leave every proposed replacement in an incompatible node group unapplied, including conflicts in incident-way grade/access context and transitive same-dataset diagnostic chains. Compatible groups, authoritative same-ID updates, and existing exact-way descriptive reconciliation retain their established behavior. High-level merges still do not normalize either original input.
