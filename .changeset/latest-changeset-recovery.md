---
"osmix": patch
---

Recover the latest successfully generated changeset for each base dataset after a worker restart, whether it came from ordinary merge or imported-data matching. Retain valid candidate-review sessions independently, and invalidate only their dependent previews when decisions change or review is cleared. Preserve changeset filters and invalidate stale review and generation state when an input is replaced, deleted, or renamed.
