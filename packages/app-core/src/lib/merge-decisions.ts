import type { PatchIdMode, PlanDecision } from "osmix";

/**
 * A merge review's decisions, saved for the input pair they were made on. Proposal IDs are
 * stable for the same inputs and patch-ID mode, so the key is the inputs' content hashes and
 * the mode; the file hashes tie the record to stored datasets, which take it with them.
 */
export interface SavedMergeDecisions {
  key: string;
  baseContentHash: string;
  patchContentHash: string;
  patchIds: PatchIdMode;
  baseFileHash?: string;
  patchFileHash?: string;
  decisions: PlanDecision[];
  savedAt: number;
}

/** The key decisions for this input pair and patch-ID mode are saved under. */
export function mergeDecisionsKey(
  baseContentHash: string,
  patchContentHash: string,
  patchIds: PatchIdMode,
) {
  return `${baseContentHash}:${patchContentHash}:${patchIds}`;
}
