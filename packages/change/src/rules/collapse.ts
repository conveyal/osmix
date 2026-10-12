/** Whether rewriting a way's refs would leave it broken. */

/** True when two consecutive refs are the same node (a zero-length segment). */
export function hasAdjacentDuplicateRefs(refs: readonly number[]): boolean {
  return refs.some((ref, index) => index > 0 && ref === refs[index - 1]);
}

/** True when a way would keep fewer than two distinct nodes. */
export function hasTooFewDistinctRefs(refs: readonly number[]): boolean {
  return new Set(refs).size < 2;
}

/** Either failure: the rewritten way would collapse or gain a zero-length segment. */
export function refsWouldCollapse(refs: readonly number[]): boolean {
  return hasAdjacentDuplicateRefs(refs) || hasTooFewDistinctRefs(refs);
}
