# @osmix/types

## 0.2.0

### Minor Changes

- 66eb7cd: **Breaking:** make node tag filters safe for routing. Node rules now select only standalone nodes: a tag-filtered load keeps every node that a kept way or relation references, and `pruneUnreferencedNodes` drops the rest after ingestion. `CONVEYAL_EXTRACT_TAG_FILTERS` now keeps only `park_ride` standalone nodes, which makes R5 extracts much smaller. Extracts never remove members from a turn restriction: `simple` and `complete_ways` drop a restriction the bbox cuts, and `smart` completes it. Adds `isRestrictionRelation`.

### Patch Changes

- 466adc0: Share one-way normalization between exact reconciliation, fuzzy way matching, and routing. Respect explicit `no`, `false`, and `0` on roundabouts, recognize equivalent supported aliases, and compare reversed geometry consistently. Prevent unsupported values from being treated as direction-equivalent during matching while retaining the router's documented fallback behavior.

  Block fuzzy matches when endpoint geometry cannot establish the orientation needed to compare one-way travel, including closed one-way roundabouts. Bidirectional ways without recognized direction-sensitive tags remain eligible.

## 0.1.0

### Minor Changes

- 368d103: Introduce focused packages extracted from `@osmix/shared`.
