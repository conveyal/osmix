# @osmix/types

## 0.1.1

### Patch Changes

- 466adc0: Share one-way normalization between exact reconciliation, fuzzy way matching, and routing. Respect explicit `no`, `false`, and `0` on roundabouts, recognize equivalent supported aliases, and compare reversed geometry consistently. Prevent unsupported values from being treated as direction-equivalent during matching while retaining the router's documented fallback behavior.

  Block fuzzy matches when endpoint geometry cannot establish the orientation needed to compare one-way travel, including closed one-way roundabouts. Bidirectional ways without recognized direction-sensitive tags remain eligible.

## 0.1.0

### Minor Changes

- 368d103: Introduce focused packages extracted from `@osmix/shared`.
