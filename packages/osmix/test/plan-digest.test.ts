import { readFileSync } from "node:fs";

import type { Osm } from "@osmix/core";
import { fromPbf } from "@osmix/load";
import { getFixtureFileReadStream, getFixturePath } from "@osmix/test-utils/fixtures";
import {
  MONACO_MERGE_CONFLATION,
  MONACO_MERGE_PATCH,
} from "@osmix/test-utils/monaco-merge-scenarios";
import { planDigest } from "@osmix/test-utils/plan-digest";
import { beforeAll, describe, expect, it } from "vitest";

import {
  applyPlan,
  fromGeoJSON,
  generateMergePlanOsc,
  type MergePlan,
  type MergePlanOptions,
  planMerge,
  setMergePlanDecisions,
} from "../src/index.ts";

/**
 * The planner's whole output on the Monaco scenario patch, as digests recorded before T35 read
 * the patch as a layer. A change to how the planner stores its state must leave every one
 * as it is. When a change to merge rules alters the output on purpose, record the new digests
 * here and say why in the commit. T36 blocks a replacement that joined grade-separated highways
 * (`replacement-grade-conflict`): Aggressive no longer includes it, so its plan applies. T24 lets
 * imported values win a way reconcile (X4 now reconciles, with or without matching) and makes a
 * connection merge its point's tags (M2, M3 and M7 change). Then a copy follows its applied
 * connection at Recommended and Aggressive (M2's kerb copy), which changes only the plans.
 */

let base: Osm;
let patch: Osm;

beforeAll(async () => {
  base = await fromPbf(getFixtureFileReadStream("monaco.pbf"), { id: "monaco" });
  patch = await fromGeoJSON(readFileSync(getFixturePath(MONACO_MERGE_PATCH), "utf8"), {
    id: "monaco-merge-patch",
  });
});

const quiet = () => {};
const matching: MergePlanOptions = {
  matching: {
    ...MONACO_MERGE_CONFLATION,
    propertyKeys: [...MONACO_MERGE_CONFLATION.propertyKeys],
    allowWayReplacement: true,
  },
};

const digest = (plan: MergePlan) =>
  planDigest(
    plan,
    plan.diagnostics.integrity.length > 0 ? "refused" : applyPlan(plan).osm,
    generateMergePlanOsc(plan),
  );

describe("merge plan output on Monaco", () => {
  it("is unchanged without matching", () => {
    expect(digest(planMerge(base, patch, {}, quiet))).toEqual({
      plan: "5613cf2d49f5d89b",
      applied: "376f5c20",
      osc: "9ba6e7249a757904",
    });
  });

  it("is unchanged with matching, at each automation level", () => {
    const levels = ["conservative", "recommended", "aggressive"] as const;
    expect(
      Object.fromEntries(
        levels.map((automation) => [
          automation,
          digest(planMerge(base, patch, { ...matching, automation }, quiet)),
        ]),
      ),
    ).toEqual({
      conservative: { plan: "bdac21d1e4a2a453", applied: "376f5c20", osc: "9ba6e7249a757904" },
      recommended: { plan: "acd38595f6085071", applied: "dc374e92", osc: "c464052281d5e1df" },
      aggressive: { plan: "43fdfbedadfc6c67", applied: "17925075", osc: "0b26800a4266c3a4" },
    });
  });

  it("is unchanged after a replan, and equal to a fresh plan with the same decisions", () => {
    const plan = planMerge(base, patch, matching, quiet);
    // Include a few proposals that wait for a person, none of which leaves out another.
    const chosen: string[] = [];
    const left = new Set<string>();
    for (const proposal of plan.proposals.values()) {
      if (proposal.status !== "review" || left.has(proposal.id)) continue;
      chosen.push(proposal.id);
      for (const other of [
        ...("alternatives" in proposal ? proposal.alternatives : []),
        ...("competitors" in proposal ? proposal.competitors : []),
        ...(proposal.excludes ?? []),
      ])
        left.add(other);
      if (chosen.length === 5) break;
    }
    const decisions = chosen.map((proposalId) => ({ proposalId, action: "accept" as const }));
    setMergePlanDecisions(plan, decisions);
    const fresh = planMerge(base, patch, { ...matching, decisions }, quiet);
    expect(digest(plan)).toEqual(digest(fresh));
    expect(digest(plan)).toEqual({
      plan: "a052f1b49bd66edd",
      applied: "cb170a40",
      osc: "a9a91ce0efcb26a7",
    });
  });
});
