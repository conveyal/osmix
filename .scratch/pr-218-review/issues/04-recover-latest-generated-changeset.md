# 04: Recover the latest generated changeset

**What to build:** Restore the exact preview the caller most recently generated after a worker restart. The [PR #218](https://github.com/conveyal/osmix/pull/218) review reproduced a P2 failure: an ordinary direct-merge preview replaces a conflation preview, but recovery regenerates the older conflation changeset over it.

**Blocked by:** None (can start immediately).

**Status:** completed

- [x] Track one authoritative active generated changeset per base dataset, including its generation kind and required inputs. Generating a replacement supersedes the prior generated result without losing an otherwise valid candidate-review session.
- [x] Reproduce discovery and conflation generation followed by ordinary direct generation. Before and after a control-worker restart, the preview contains the same creates, modifications, and deletions, and applying it produces the same entities.
- [x] Cover the reverse generation order, changeset filters, multiple base datasets, and an ordinary preview generated while reviewed candidate decisions are retained.
- [x] Editing or clearing candidate decisions invalidates only output that actually depends on those decisions. It does not discard a newer unrelated ordinary changeset.
- [x] Replacing, deleting, or renaming either input continues to invalidate stale review and generation state. Recovery cannot revive a superseded preview or replay decisions against new input contents.
- [x] Add worker/remote recovery regressions that compare complete preview content and applied results, not just the existence of a restored changeset.
- [x] Document the latest-generation-wins contract and keep public preview/application behavior compatible. Required workspace and dependent checks pass.
