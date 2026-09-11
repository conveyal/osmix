---
"@osmix/change": patch
"osmix": patch
---

Keep alternative targets together for each imported feature and enforce one target with scheduled matching actions. Add a source-level decision helper that replaces a target or leaves the feature unmatched while preserving unrelated choices. Allow older conflicting reviews to be corrected one feature at a time; generation stays blocked until all conflicts are resolved. Reject invalid replacements before changing decisions or invalidating previews, and support grouped pagination with all alternatives visible. Let Merge users return from reconciliation, a cumulative preview before application, or generation failure to correct matching choices without reloading their original inputs.
