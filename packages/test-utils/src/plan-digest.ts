import { createHash } from "node:crypto";

/**
 * What a merge plan produced, as short digests, so a change to how the planner works can show it
 * changed nothing (T35). `plan` covers the features, proposals (in order, with status, reasons,
 * effect and links), summary, diagnostics and stale decisions; `applied` is the built dataset's
 * content hash, or `refused` when the plan has integrity issues; `osc` the osmChange output.
 * Items are hashed one at a time, so a plan of millions of proposals never becomes one string.
 */
export interface PlanDigest {
  plan: string;
  applied: string;
  osc: string;
}

/** The parts of a merge plan the digest reads; `@osmix/change`'s `MergePlan` has them. */
interface DigestablePlan {
  features: Iterable<unknown>;
  proposals: Map<string, unknown>;
  summary: unknown;
  diagnostics: unknown;
  staleDecisions: unknown;
}

/** SHA-256 of each item's JSON in turn, separated so item boundaries count. */
function hashItems(...parts: Iterable<unknown>[]) {
  const hash = createHash("sha256");
  for (const part of parts) {
    for (const item of part) {
      hash.update(JSON.stringify(item) ?? "undefined");
      hash.update("\n");
    }
    hash.update("\u0000");
  }
  return hash.digest("hex").slice(0, 16);
}

export function planDigest(
  plan: DigestablePlan,
  applied: { contentHash(): string } | "refused",
  osc: string,
): PlanDigest {
  return {
    plan: hashItems(plan.features, plan.proposals.values(), [
      plan.summary,
      plan.diagnostics,
      plan.staleDecisions,
    ]),
    applied: applied === "refused" ? applied : applied.contentHash(),
    osc: createHash("sha256").update(osc).digest("hex").slice(0, 16),
  };
}
