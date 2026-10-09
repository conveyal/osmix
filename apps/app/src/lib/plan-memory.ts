/**
 * Whether the browser can plan a merge before it tries (T34). Planning keeps one JS object or
 * more per imported entity in the plan worker's heap, and Chromium caps that heap at about 3.7
 * GB; running out crashes the tab rather than failing the task. So Merge estimates the planning
 * peak from the import's size and refuses imports that would not fit.
 *
 * Measured with `apps/bench` plan-memory (Node) and Chromium over CDP after T35, which reads
 * untouched imports from the patch instead of storing a record for each. Peak heap per imported
 * entity in Chromium, a replan included: 1.38 KB with matching (Seattle: 2.08M entities,
 * 2.9 GB; Washington: 1.48M, 1.6 GB) and 0.77 KB without (Seattle, 1.6 GB). The larger import
 * sets each figure, rounded up.
 */

/** Heap the planning peak may reach; Chromium's limit less room for the rest of the worker. */
export const PLAN_HEAP_BUDGET_BYTES = 3.5e9;

const PEAK_BYTES_PER_IMPORTED_ENTITY = { matching: 1_400, direct: 800 } as const;

/** The planning peak, in bytes, for an import of `stats` entities. */
export function estimatePlanHeapBytes(
  stats: { nodes: number; ways: number; relations: number },
  matching: boolean,
) {
  const entities = stats.nodes + stats.ways + stats.relations;
  return entities * PEAK_BYTES_PER_IMPORTED_ENTITY[matching ? "matching" : "direct"];
}

const gb = (bytes: number) => `${(bytes / 1e9).toFixed(1)} GB`;

/** Why this import cannot be planned in the browser, or null when it fits. */
export function planTooLargeReason(
  stats: { nodes: number; ways: number; relations: number },
  matching: boolean,
): string | null {
  const estimate = estimatePlanHeapBytes(stats, matching);
  if (estimate <= PLAN_HEAP_BUDGET_BYTES) return null;
  const entities = (stats.nodes + stats.ways + stats.relations).toLocaleString();
  const withoutMatching = estimatePlanHeapBytes(stats, false) <= PLAN_HEAP_BUDGET_BYTES;
  return (
    `Planning ${entities} imported entities ${matching ? "with matching " : ""}needs about ` +
    `${gb(estimate)} of memory, and the browser allows ${gb(PLAN_HEAP_BUDGET_BYTES)}, so ` +
    "the tab would crash. Split the import into smaller areas with Extract" +
    (matching && withoutMatching ? ", or plan it without matching." : ".")
  );
}
