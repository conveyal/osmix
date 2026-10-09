---
"@osmix/change": minor
"osmix": minor
---

**Breaking:** the matching outcome's `unresolvedFeatures` no longer counts imported features with no base feature within the matching radius; `unmatchedFeatures` counts those, and each keeps `unresolved: "unmatched"`. `getMergeMatchingPage` takes a new `"unmatched"` filter, and its `"unresolved"` filter leaves them out.
