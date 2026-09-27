/**
 * Identify a committed worker mutation whose replicas still need synchronization before refresh.
 * Duck-typed so it also recognizes an `OsmixCommittedMutationError` after a worker round trip.
 */
export function committedMutationOsmId(
  error: unknown,
  operation: "applyChangesAndReplace" | "merge",
): string | null {
  return error &&
    typeof error === "object" &&
    "committed" in error &&
    error.committed === true &&
    "operation" in error &&
    error.operation === operation &&
    "osmId" in error &&
    typeof error.osmId === "string" &&
    error.osmId.length > 0
    ? error.osmId
    : null;
}
