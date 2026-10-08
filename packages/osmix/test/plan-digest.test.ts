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
 * (`replacement-grade-conflict`): Aggressive no longer includes it, so its plan applies.
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
      plan: "4e60094bd6251a40",
      applied: "42770a36",
      osc: "20e8e321a6d4d07c",
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
      conservative: { plan: "e584762ca976dc37", applied: "42770a36", osc: "20e8e321a6d4d07c" },
      recommended: { plan: "df7e2ffb149d98fa", applied: "03605608", osc: "9c68884088a19925" },
      aggressive: { plan: "41e8f195f02c9aba", applied: "43d93040", osc: "d552c3eecfb84fe8" },
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
      plan: "552e741601f205c1",
      applied: "7d9928ef",
      osc: "573b7d76ae274a6a",
    });
  });
});
