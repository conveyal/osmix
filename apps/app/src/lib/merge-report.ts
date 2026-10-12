import { streamedArray } from "@osmix/app-core";
import type { OsmixRemote } from "osmix";

import type { MergeCompletion } from "../state/merge-outcome";

const REPORT_PAGE_SIZE = 5_000;

async function* allPages<T>(
  load: (page: number) => Promise<{ features: T[]; totalPages: number }>,
) {
  for (let page = 0; ; page++) {
    const result = await load(page);
    yield result.features;
    if (page + 1 >= result.totalPages) return;
  }
}

/**
 * The completed merge's report. The matching outcome's feature and tag lists stay in the worker
 * until the report is written; they are read page by page, never as one object.
 */
export function mergeOutcomeReport(
  completion: MergeCompletion,
  remote: Pick<OsmixRemote, "getMergeMatchingPage" | "getMergeUncopiedTagPage">,
): Record<string, unknown> {
  const { plan } = completion;
  const baseOsmId = plan.inputs.base.id;
  const matching = plan.matching;
  if (!matching) return { format: "osmix-merge-outcome", version: 2, ...completion };
  const { tags, wayRemovalFeatures: _, ...outcome } = matching.outcome;
  return {
    format: "osmix-merge-outcome",
    version: 2,
    ...completion,
    plan: {
      ...plan,
      matching: {
        ...matching,
        outcome: {
          ...outcome,
          features: streamedArray(() =>
            allPages((page) =>
              remote.getMergeMatchingPage(baseOsmId, "all", page, REPORT_PAGE_SIZE),
            ),
          ),
          tags: tags.map(({ uncopiedFeatures: _count, ...tag }) => ({
            ...tag,
            uncopied: streamedArray(() =>
              allPages((page) =>
                remote.getMergeUncopiedTagPage(baseOsmId, tag.key, page, REPORT_PAGE_SIZE),
              ),
            ),
          })),
        },
      },
    },
  };
}
