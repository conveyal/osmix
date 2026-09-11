---
"@osmix/types": patch
"@osmix/change": patch
"@osmix/router": patch
"osmix": patch
---

Share one-way normalization between exact reconciliation, fuzzy way matching, and routing. Respect explicit `no`, `false`, and `0` on roundabouts, recognize equivalent supported aliases, and compare reversed geometry consistently. Prevent unsupported values from being treated as direction-equivalent during matching while retaining the router's documented fallback behavior.

Block fuzzy matches when endpoint geometry cannot establish the orientation needed to compare one-way travel, including closed one-way roundabouts. Bidirectional ways without recognized direction-sensitive tags remain eligible.
