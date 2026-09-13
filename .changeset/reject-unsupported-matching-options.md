---
"@osmix/change": patch
"osmix": patch
---

Reject defined `conflation` options passed to ordinary `generateChangeset()` instead of returning a preview that silently omits requested matching. Export `OsmChangesetOptions` for the supported ordinary stages and retain runtime validation for JavaScript, worker/remote calls, and structurally wider typed objects. Undefined matching options remain equivalent to omission.

The rejection preserves existing generated previews and datasets and directs callers to `generateConflationChangeset()` or `merge()`. Supported direct matching APIs and worker/remote generation from reviewed matching sessions retain their existing behavior.
