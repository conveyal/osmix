---
"@osmix/change": minor
"osmix": minor
---

**Breaking:** the staged merge APIs are removed in favor of merge plans.

- `generateChangeset`, the `OsmChangeset` stage methods, `OsmChangeset.toJSON`/`fromJson`, and the `@osmix/change/internal/*` exports are gone. Use `planMerge`, `setMergePlanDecisions`, `applyPlan` and `generateMergePlanOsc`; `merge()` plans and applies in one call.
- The conflation generators and review helpers (`generateConflationChangeset`, `generateConflationArtifacts`, `generateConflationApplicationChangeset`, `buildConflationActionDecision`, `buildConflationSourceDecision`, `resolveConflationActions`, `filterConflationCandidates`, `summarizeConflationCandidates`, `validateConflationDecisions`, `conflationEffectiveStatus`) are gone. Matching actions are plan proposals; `discoverConflationCandidates` remains for inspecting candidates.
- Types removed with them include `OsmMergeOptions`, `OsmChangesetOptions`, `OsmChanges`, `OsmConflationCandidateFilter` and the `OsmConflationBulk*` types; use `MergePlanOptions`, `PlanDecision` and `MergePlanBulkRequest`.
- `OsmixWorker` and `OsmixRemote` drop their conflation sessions and `generateChangeset`. Use the plan session methods: `planMerge`, `getMergePlanOverview`, `getMergePlanPage`, `getMergePlanFeature`, `getMergePlanTile`, `getMergeMatchingPage`, `getMergeUncopiedTagPage`, `setMergePlanDecisions`, `applyMergePlanBulk`, `getMergePlanOsc`, `applyMergePlan` and `clearMergePlan`. Inspect's duplicate fixes use `planDeduplication`.
- Changesets are no longer serialized. After a worker restart the remote rebuilds each plan from its inputs, options and decisions, and throws `OsmixPlanRecoveryError` if either input changed.
