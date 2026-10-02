---
"@osmix/change": minor
"osmix": minor
---

Node merges with an imported point (identical points and crossing snaps) now take the imported values: they replace conflicting base values and may add access and barrier tags, such as a curb ramp's `barrier=kerb`. A merge that would change the base point's grade (layer, level, bridge, tunnel, covered) is a review proposal with reason `grade-change`; no automation level decides it (MP-X1, MP-J1). Crossing IDs now write a coordinate that rounds to zero as `0`, so one crossing reported either side of zero is one proposal.
