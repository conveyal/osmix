# 05: Preserve changeset validation through serialization

**What to build:** Let callers serialize and restore changesets without changing their validated meaning. The [PR #218](https://github.com/conveyal/osmix/pull/218) review reproduced a P2 failure where direct generation accepts an inherited patch grade issue, but restoring the same changes from JSON loses that context and rejects application as a newly introduced issue.

**Blocked by:** None (can start immediately).

**Status:** completed

- [x] Original and restored changesets use equivalent, verifiable context to distinguish inherited input problems from newly introduced integrity failures.
- [x] Reproduce an empty base and a patch containing a surface way through nodes 1, 2, and 3 and a bridge through nodes 2 and 4. If the generated changeset is applicable under the inherited-issue policy, its supported JSON round trip applies to the same result.
- [x] A round trip does not disable checks for new dangling references, collapsed highways, broken restrictions, or newly connected grade-separated ways.
- [x] Serialized context is tied to the corresponding inputs. Caller-supplied issue exemptions are not accepted as an unchecked way to bypass integrity validation.
- [x] Define and document compatibility for existing changes-only JSON. Safe legacy cases remain usable; cases requiring unavailable source context fail with a specific, actionable explanation rather than silently changing policy.
- [x] Cover matching and mismatched input context, existing base issues, inherited patch issues, and deliberately introduced new issues. Compare restored application output as well as success/failure.
- [x] Update public serialization/restoration types and documentation where needed, with targeted regressions and all required workspace/dependent checks passing.
