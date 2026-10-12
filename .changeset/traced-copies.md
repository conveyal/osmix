---
"@osmix/change": minor
"osmix": minor
---

Stop connecting points of an imported path that runs along a base path (a copy of the same path) to that path: such connections are blocked with `traces-base-way` and no longer compete for the base point. The new `traceLengthMeters` matching option (default 10 m) sets how far the paths must run together. Connections from an imported way's end are no longer flagged for their angle; points along a way keep the 30° bearing check.
