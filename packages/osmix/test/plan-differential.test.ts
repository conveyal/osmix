/**
 * The planner must produce what the staged merge pipeline produces. Until the pipeline is
 * retired, each planner phase is compared with `merge()` by content hash on the Monaco fixture
 * patch and the synthetic routing fixtures.
 */
import { readFileSync } from "node:fs";

import {
  applyPlan,
  discoverConflationCandidates,
  type MergePlan,
  type OsmConflationDecision,
  type PlanDecision,
  planMerge,
} from "@osmix/change";
import type { Osm } from "@osmix/core";
import { fromPbf } from "@osmix/load";
import { getFixtureFileReadStream, getFixturePath } from "@osmix/test-utils/fixtures";
import {
  MONACO_MERGE_CONFLATION,
  MONACO_MERGE_PATCH,
} from "@osmix/test-utils/monaco-merge-scenarios";
import { beforeAll, describe, expect, it } from "vitest";

import { fromGeoJSON, merge } from "../src/index.ts";
import {
  createMonacoRoutingPatch,
  createSyntheticConflationRoutingInputs,
  createSyntheticRoutingBase,
  createSyntheticRoutingPatch,
} from "./synthetic-routing-fixture.ts";

const quiet = () => {};

let monaco: Osm;
let monacoPatch: Osm;

beforeAll(async () => {
  monaco = await fromPbf(getFixtureFileReadStream("monaco.pbf"), { id: "monaco" });
  monacoPatch = await fromGeoJSON(readFileSync(getFixturePath(MONACO_MERGE_PATCH), "utf8"), {
    id: "monaco-merge-patch",
  });
});

const cases: [string, () => { base: Osm; patch: Osm }][] = [
  ["the Monaco fixture patch", () => ({ base: monaco, patch: monacoPatch })],
  [
    "a Monaco boundary extension",
    () => ({ base: monaco, patch: createMonacoRoutingPatch(monaco) }),
  ],
  [
    "the synthetic routing network",
    () => ({ base: createSyntheticRoutingBase(), patch: createSyntheticRoutingPatch() }),
  ],
  ["the synthetic conflation network", () => createSyntheticConflationRoutingInputs()],
];

/** The merged content hash, or the error that rejected the merge: both must match. */
async function outcome(run: () => Osm | Promise<Osm>) {
  try {
    return { contentHash: (await run()).contentHash() };
  } catch (error) {
    return { error: error instanceof Error ? error.message : String(error) };
  }
}

describe("plan versus staged merge", () => {
  it.each(cases)("direct changes match on %s", async (_name, inputs) => {
    const { base, patch } = inputs();
    const expected = await outcome(() => merge(base, patch, { directMerge: true }, quiet));
    const actual = await outcome(
      () => applyPlan(planMerge(base, patch, { mergeIdenticalPoints: false }, quiet)).osm,
    );
    expect(actual).toEqual(expected);
  });

  it.each(cases)("identical points and ways match on %s", async (_name, inputs) => {
    const { base, patch } = inputs();
    const exact = { directMerge: true, deduplicateNodes: true, deduplicateWays: true };
    const expected = await outcome(() => merge(base, patch, exact, quiet));
    const actual = await outcome(() => applyPlan(planMerge(base, patch, {}, quiet)).osm);
    expect(actual).toEqual(expected);
  });

  const matching = {
    ...MONACO_MERGE_CONFLATION,
    propertyKeys: [...MONACO_MERGE_CONFLATION.propertyKeys],
  };

  it.each(cases)("automatic matching matches on %s", async (_name, inputs) => {
    const { base, patch } = inputs();
    const staged = { directMerge: true, deduplicateNodes: true, deduplicateWays: true };
    const expected = await outcome(() =>
      merge(base, patch, { ...staged, conflation: matching }, quiet),
    );
    const actual = await outcome(() => applyPlan(planMerge(base, patch, { matching }, quiet)).osm);
    expect(actual).toEqual(expected);
  });

  it.each(cases)("reviewed matching matches on %s", async (_name, inputs) => {
    const { base, patch } = inputs();
    // Accept every candidate that needs review, with its default actions and any removal.
    const decisions: OsmConflationDecision[] = discoverConflationCandidates(base, patch, matching)
      .candidates.filter((candidate) => candidate.status === "review")
      .map((candidate) => ({
        candidateId: candidate.id,
        action: "accept",
        ...(candidate.wayRemoval?.status === "review" ? { removeWay: true } : {}),
      }));
    const staged = { directMerge: true, deduplicateNodes: true, deduplicateWays: true };
    const expected = await outcome(() =>
      merge(base, patch, { ...staged, conflation: { ...matching, decisions } }, quiet),
    );
    const actual = await outcome(() => {
      const undecided = planMerge(base, patch, { matching }, quiet);
      const plan = planMerge(
        base,
        patch,
        { matching, decisions: planDecisions(undecided, decisions) },
        quiet,
      );
      return applyPlan(plan).osm;
    });
    expect(actual).toEqual(expected);
  });
});

describe("plan matching candidates", () => {
  it("differ from untouched-input discovery only by sources identity already merged", () => {
    const matching = {
      ...MONACO_MERGE_CONFLATION,
      propertyKeys: [...MONACO_MERGE_CONFLATION.propertyKeys],
    };
    const plan = planMerge(monaco, monacoPatch, { matching }, quiet);
    const merged = new Set<string>();
    for (const proposal of plan.proposals.values()) {
      if (proposal.effect !== "applied") continue;
      if (proposal.kind !== "exact-merge" && proposal.kind !== "way-reconcile") continue;
      merged.add(`${proposal.source.type}:${proposal.source.id}`);
    }
    expect(merged.size).toBeGreaterThan(0);
    const expected = discoverConflationCandidates(monaco, monacoPatch, matching)
      .candidates.filter((candidate) => candidate.targetId != null)
      .filter((candidate) => !merged.has(`${candidate.entityType}:${candidate.sourceId}`))
      .map((candidate) => candidate.id);
    const actual = new Set<string>();
    for (const proposal of plan.proposals.values()) {
      if ("candidateId" in proposal) actual.add(proposal.candidateId);
    }
    expect([...actual].toSorted()).toEqual(expected.toSorted());
  });
});

/** The plan decisions equivalent to matching decisions on the same candidates. */
function planDecisions(plan: MergePlan, decisions: readonly OsmConflationDecision[]) {
  const byCandidate = new Map(decisions.map((decision) => [decision.candidateId, decision]));
  const result: PlanDecision[] = [];
  for (const proposal of plan.proposals.values()) {
    if (!("candidateId" in proposal)) continue;
    const decision = byCandidate.get(proposal.candidateId);
    if (!decision) continue;
    const selected =
      decision.action === "accept" &&
      (proposal.kind === "connect"
        ? (decision.attachNetwork ?? true)
        : proposal.kind === "copy-tags"
          ? (decision.transferProperties ?? true)
          : decision.removeWay === true);
    if (proposal.kind === "remove-way" && !selected) continue;
    result.push({ proposalId: proposal.id, action: selected ? "accept" : "reject" });
  }
  return result;
}
