---
"@osmix/change": minor
"osmix": minor
---

Add `proposalTagChanges(plan, proposalId)`: the tags of the entity a proposal changes, before and after, by the rule the planner applies for its kind, whether or not the proposal is included yet. Merge plan feature views carry them as `tagChanges`, by proposal ID, and crossing snaps that make two vertices one record them as `merges`.
