/**
 * The planner must produce what the staged merge pipeline produces. Until the pipeline is
 * retired, each planner phase is compared with `merge()` by content hash on the Monaco fixture
 * patch and the synthetic routing fixtures.
 */
import { readFileSync } from "node:fs";

import { applyPlan, planMerge } from "@osmix/change";
import type { Osm } from "@osmix/core";
import { fromPbf } from "@osmix/load";
import { getFixtureFileReadStream, getFixturePath } from "@osmix/test-utils/fixtures";
import { MONACO_MERGE_PATCH } from "@osmix/test-utils/monaco-merge-scenarios";
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
});
