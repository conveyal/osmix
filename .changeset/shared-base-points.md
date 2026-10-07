---
"@osmix/change": minor
"osmix": minor
---

Let one base node take connections from several imported ways (MP-M5): where one imported way ends and the next starts near the same base point, both connect there instead of competing. Two connections to one base node still compete when their points are on one imported way, or when the junction they would make together joins different grades. Conflation candidates list such conflicts in the new `connectionRivals` field, and node tag copies onto one base point get `many-to-one` only when more than one of them can apply.
