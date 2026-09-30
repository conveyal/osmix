---
"@osmix/change": minor
"osmix": minor
---

Add merge plan automation levels (`automation: "conservative" | "recommended" | "aggressive"`, default `"recommended"`). Recommended settles points of one imported way competing for one base point by the clearly nearest; Aggressive also settles other choices between candidates that way and copies routing tags with no competing choice. Decisions the level makes are marked `automated` on proposals, counted in `summary.automated`, and always give way to a person's decisions. Removals and blocked proposals are never decided (MP-M6).
