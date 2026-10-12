import type { MergePlanOverview } from "osmix";
import { describe, expect, it } from "vitest";

import {
  mergeDecisionsFile,
  parseMergeDecisionsFile,
  sameInputs,
} from "../src/lib/merge-decisions-file";

const overview = {
  inputs: { base: { id: "b", contentHash: "base1" }, patch: { id: "p", contentHash: "patch1" } },
  options: {
    patchIds: "osm",
    automation: "recommended",
    decisions: [{ proposalId: "connect:n-1>n1", action: "accept" }],
  },
  decisions: [{ proposalId: "connect:n-1>n1", action: "accept" }],
} as unknown as MergePlanOverview;

describe("merge decisions file", () => {
  it("writes the decisions with the inputs and options they were made on", () => {
    const file = mergeDecisionsFile(overview, { base: "base.pbf", patch: "patch.pbf" });
    expect(file).toEqual({
      format: "osmix-merge-decisions",
      version: 1,
      inputs: {
        base: { contentHash: "base1", name: "base.pbf" },
        patch: { contentHash: "patch1", name: "patch.pbf" },
      },
      options: { patchIds: "osm", automation: "recommended" },
      decisions: [{ proposalId: "connect:n-1>n1", action: "accept" }],
    });
    expect(parseMergeDecisionsFile(JSON.stringify(file))).toEqual(file);
    expect(sameInputs(file, overview)).toBe(true);
    const other = { inputs: { ...overview.inputs, patch: { id: "p", contentHash: "patch2" } } };
    expect(sameInputs(file, other)).toBe(false);
  });

  it("refuses files that are not merge choices", () => {
    const file = mergeDecisionsFile(overview, { base: "b", patch: "p" });
    expect(() => parseMergeDecisionsFile("not json")).toThrow("not JSON");
    expect(() => parseMergeDecisionsFile("{}")).toThrow("not an Osmix merge choices file");
    expect(() => parseMergeDecisionsFile(JSON.stringify({ ...file, version: 2 }))).toThrow(
      "version 2",
    );
    expect(() =>
      parseMergeDecisionsFile(
        JSON.stringify({ ...file, decisions: [{ proposalId: "x", action: "maybe" }] }),
      ),
    ).toThrow("malformed choices");
    expect(() => parseMergeDecisionsFile(JSON.stringify({ ...file, inputs: {} }))).toThrow(
      "which files",
    );
  });
});
