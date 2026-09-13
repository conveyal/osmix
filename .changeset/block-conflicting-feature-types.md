---
"@osmix/change": patch
"osmix": patch
---

Block imported-data matching between conflicting explicit feature classifications, such as a school and a cafe, independently of the tag keys selected for copying. Preserve this hard block for both matching actions during manual and bulk acceptance and when relation membership adds review context. Candidate evidence reports the conflicting base and imported values for inspection in Merge.

Compare supported classifications on the same key, treating missing or empty values as unknown and generic `yes` as an unspecified positive subtype. Explicit `no` still conflicts with different nonempty values. This matching check does not alter ordinary direct/exact merge rules or authoritative same-ID updates.
