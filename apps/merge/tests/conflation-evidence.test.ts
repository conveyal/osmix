import type { OsmConflationCandidateView } from "osmix";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { CandidateEvidence } from "../src/components/conflation-review";

function candidate(
  distanceMeters: number,
  targetId: number | null = 22,
): OsmConflationCandidateView {
  return {
    id: "node:11->22",
    entityType: "node",
    sourceId: 11,
    targetId,
    status: targetId == null ? "unmatched" : "review",
    reasons: [],
    propertyTransfer: { status: "review", reasons: [] },
    networkAttachment: null,
    evidence: {
      distanceMeters,
      sourceRoutingFamilies: ["pedestrian"],
      targetRoutingFamilies: ["pedestrian"],
      tagDiff: [],
    },
  };
}

const render = (value: OsmConflationCandidateView) =>
  renderToStaticMarkup(createElement(CandidateEvidence, { candidate: value }));

describe("matching evidence for imported features", () => {
  it("shows finite distances with units, including a coincident match", () => {
    expect(render(candidate(0.25))).toContain("0.250 m");
    expect(render(candidate(0))).toContain("0.000 m");
  });

  it("explains unmatched searches without showing an infinite distance", () => {
    const html = render(candidate(Infinity, null));
    expect(html).toContain("No eligible base target within search radius");
    expect(html).not.toContain("Infinity");
  });

  it.each([Infinity, -Infinity, Number.NaN, -1])(
    "distinguishes an unavailable distance (%s) from an unmatched search",
    (distance) => {
      const html = render(candidate(distance));
      expect(html).toContain("Distance unavailable for this target");
      expect(html).not.toContain("No eligible base target within search radius");
    },
  );

  it("handles a missing measurement in restored evidence without throwing", () => {
    const value = candidate(0.25);
    Reflect.deleteProperty(value.evidence, "distanceMeters");
    expect(render(value)).toContain("Distance unavailable for this target");
  });

  it("explains unsupported nearby segments without claiming the search found nothing", () => {
    const value = candidate(Infinity, null);
    value.reasons = ["unsupported-way-chain"];
    expect(render(value)).toContain("Nearby segments cannot form one supported match");
  });

  it("makes attribute restrictions explicit and preserves full selectable values", () => {
    const value = candidate(0.25);
    value.evidence.tagDiff = [
      { key: "layer", baseValue: "0", patchValue: "1", protected: true, routing: false },
      {
        key: "crossing",
        baseValue: "unmarked",
        patchValue: "traffic_signals",
        protected: false,
        routing: true,
      },
      {
        key: "description",
        patchValue: "A long imported description with exact details that must remain readable",
        protected: false,
        routing: false,
      },
    ];
    const html = render(value);
    expect(html).toContain("Base value");
    expect(html).toContain("Imported value");
    expect(html).toContain("Protected attribute: this value cannot be copied");
    expect(html).toContain("Affects travel: review before copying");
    expect(html).toContain(
      "A long imported description with exact details that must remain readable",
    );
  });
});
