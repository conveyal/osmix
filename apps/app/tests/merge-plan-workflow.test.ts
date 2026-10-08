import { describe, expect, it } from "vitest";

import {
  buildMergePlanOptions,
  bulkActionLabel,
  bulkResultMessage,
  FILTERABLE_KINDS,
  isDecidable,
  makeMergedDownloadName,
  makePlanOscName,
  OUTCOME_HELP,
  OUTCOME_LABEL,
  OUTCOMES,
  planFeatureTitle,
  planReasonLabel,
  PROPOSAL_KIND_LABEL,
  proposalStatusText,
  withDecision,
} from "../src/lib/merge-plan-workflow";

describe("merge plan workflow", () => {
  it("counts bulk choices in features", () => {
    expect(bulkActionLabel("accept", 12_400)).toBe("Include 12,400 features");
    expect(bulkActionLabel("reject", 1)).toBe("Leave out 1 feature");
    expect(bulkActionLabel("clear", 0)).toBe("Clear choices for 0 features");
    expect(bulkResultMessage("accept", { changed: 12_400, waiting: 19_183 })).toBe(
      "Included 12,400 features; 19,183 features still need a decision",
    );
    expect(bulkResultMessage("reject", { changed: 3, waiting: 0 })).toBe("Left out 3 features");
    expect(bulkResultMessage("accept", { changed: 0, waiting: 1 })).toBe(
      "No shown feature changed; 1 feature still needs a decision",
    );
  });

  it("builds plan options from the input settings", () => {
    expect(
      buildMergePlanOptions({
        automation: "recommended",
        mergeIdenticalPoints: true,
        patchIds: "osm",
      }),
    ).toEqual({ automation: "recommended", mergeIdenticalPoints: true, patchIds: "osm" });
    const matching = { propertyKeys: ["kerb"], attachNetwork: true };
    const options = buildMergePlanOptions({
      automation: "aggressive",
      matching,
      mergeIdenticalPoints: false,
      patchIds: "new",
    });
    expect(options).toEqual({
      automation: "aggressive",
      mergeIdenticalPoints: false,
      patchIds: "new",
      matching,
    });
    // The worker keeps its own copy of the keys.
    expect(options.matching?.propertyKeys).not.toBe(matching.propertyKeys);
  });

  it("replaces or clears one decision without touching the others", () => {
    const decisions = [
      { proposalId: "exact:n-1>n1", action: "accept" as const },
      { proposalId: "connect:n-2>n2", action: "reject" as const },
    ];
    expect(withDecision(decisions, "exact:n-1>n1", "reject")).toEqual([
      { proposalId: "connect:n-2>n2", action: "reject" },
      { proposalId: "exact:n-1>n1", action: "reject" },
    ]);
    expect(withDecision(decisions, "connect:n-2>n2", null)).toEqual([decisions[0]]);
  });

  it("leaves out a proposal's alternatives and competitors when including it", () => {
    const a = "connect:n-1001601>n5596424436";
    const b = "connect:n-1001602>n5596424436";
    const included = [{ proposalId: b, action: "accept" as const }];
    // Including one competing connection replaces the other's inclusion with "leave out".
    expect(withDecision(included, a, "accept", [b])).toEqual([
      { proposalId: b, action: "reject" },
      { proposalId: a, action: "accept" },
    ]);
    // Leaving one out, or clearing it, touches nothing else.
    expect(withDecision(included, a, "reject", [b])).toEqual([
      ...included,
      { proposalId: a, action: "reject" },
    ]);
    expect(withDecision(included, a, null, [b])).toEqual(included);
  });

  it("decides a way replacement's set as one, dropping its members' earlier decisions", () => {
    const leftOut = [{ proposalId: "replace:w30>w10", action: "reject" as const }];
    expect(withDecision(leftOut, "replace:w20>w10", "accept", [], ["replace:w30>w10"])).toEqual([
      { proposalId: "replace:w20>w10", action: "accept" },
    ]);
  });

  it("names every outcome and filterable proposal kind", () => {
    for (const outcome of OUTCOMES) {
      expect(OUTCOME_LABEL[outcome]).toBeTruthy();
      expect(OUTCOME_HELP[outcome]).toBeTruthy();
    }
    for (const kind of FILTERABLE_KINDS) expect(PROPOSAL_KIND_LABEL[kind]).toBeTruthy();
    expect(planReasonLabel("drivable-network")).toBe("Drivable network requires review");
    // A reason code the app does not know yet still reads as words.
    expect(planReasonLabel("some-new-reason")).toBe("some new reason");
  });

  it("says a proposal's status and effect once each, and blocked only once", () => {
    expect(proposalStatusText({ status: "review", effect: "needs-decision" })).toBe(
      "Needs review · Waiting for a decision",
    );
    expect(proposalStatusText({ status: "automatic", effect: "applied" })).toBe(
      "Automatic · In the plan",
    );
    expect(proposalStatusText({ status: "blocked", effect: "blocked" })).toBe("Blocked");
  });

  it("decides everything except direct changes", () => {
    const base = {
      feature: "way:-1",
      status: "automatic" as const,
      reasons: [],
      effect: "applied" as const,
    };
    const entity = { type: "way" as const, id: -1 };
    expect(isDecidable({ ...base, id: "add:w-1", kind: "add", entity })).toBe(false);
    expect(
      isDecidable({
        ...base,
        id: "xnode:w-1|w10@0,0",
        kind: "crossing-node",
        ways: [entity, { type: "way", id: 10 }],
        point: [0, 0],
      }),
    ).toBe(true);
  });

  it("titles features and download files", () => {
    expect(planFeatureTitle({ type: "way", originalId: -9, name: "Harbour Walk" })).toBe(
      "Harbour Walk",
    );
    expect(planFeatureTitle({ type: "node", originalId: -3 })).toBe("Point -3");
    expect(makeMergedDownloadName("Monaco.osm.pbf", "Sidewalks 2026.geojson")).toBe(
      "osmix-merged-monaco-osm-with-sidewalks-2026.pbf",
    );
    expect(makePlanOscName("a.pbf", "b.pbf")).toBe("osmix-merged-a-with-b.osc");
  });
});
