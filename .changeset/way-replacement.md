---
"@osmix/change": minor
"osmix": minor
---

Add opt-in way replacement (`allowWayReplacement`, `replacementToleranceMeters`): an imported way that traces base ways can be kept in their place, deleting the base ways while their junctions, tagged points and relation memberships move to the imported way. A replacement that would join highways on different grades at a junction is blocked (`replacement-grade-conflict`).

A feature's `replaced` outcome now ranks above `merged` and `connected`, so a kept way that also connects reports as replaced. Feature details include `replaces`, the coordinates of the base ways a selected replacement would delete.
