---
"@osmix/change": patch
---

Fix planning failing with "Duplicate plan proposal" when a way passes through an imported vertex: both segments beside the vertex report the same crossing, which is now one proposal and one inserted node (MP-J1).
