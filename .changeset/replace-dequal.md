---
"@osmix/types": minor
"@osmix/change": patch
"osmix": patch
---

Add `isDeepEqual` to `@osmix/types/utils`: deep equality for primitives, arrays and plain objects, which throws a `TypeError` for other objects such as typed arrays and maps. Entity equality, merge plans and the worker's changeset filters use it instead of `dequal`, which is no longer a dependency of `@osmix/types`, `@osmix/change` or `osmix`.
