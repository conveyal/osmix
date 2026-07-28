import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { Details, DetailsContent, DetailsSummary } from "../src/components/details";
import { MERGE_GUIDE_DIAGRAM_IDS, MergeGuideDiagram } from "../src/components/merge-guide-diagram";
import {
  MERGE_STEP_GUIDE_IDS,
  MERGE_STEP_GUIDES,
  MergeStepGuide,
  type MergeStepGuideId,
} from "../src/components/merge-step-guide";

const expectedGuideIds = [
  "select",
  "run-all",
  "inspect-base",
  "inspect-patch",
  "direct",
  "review-base-diagnostic",
  "review-patch-diagnostic",
  "review-direct",
  "review-cumulative-exact",
  "review-cumulative-without-exact",
  "review-intersections",
  "match-imported",
  "reconcile",
  "intersections",
  "final",
] as const satisfies readonly MergeStepGuideId[];

const expectedDiagrams = {
  select: "pipeline",
  "run-all": "pipeline",
  "inspect-base": undefined,
  "inspect-patch": undefined,
  direct: "direct-merge",
  "review-base-diagnostic": undefined,
  "review-patch-diagnostic": undefined,
  "review-direct": "direct-merge",
  "review-cumulative-exact": "exact-reconciliation",
  "review-cumulative-without-exact": "direct-merge",
  "review-intersections": "intersections",
  "match-imported": "fuzzy-conflation",
  reconcile: "exact-reconciliation",
  intersections: "intersections",
  final: undefined,
} as const;

describe("merge step guidance", () => {
  it("defines detailed guidance for every workflow and review variant", () => {
    expect(MERGE_STEP_GUIDE_IDS).toEqual(expectedGuideIds);
    expect(Object.keys(MERGE_STEP_GUIDES)).toEqual(expectedGuideIds);

    for (const guideId of expectedGuideIds) {
      const guide = MERGE_STEP_GUIDES[guideId];
      expect(guide.summary.length, `${guideId} summary`).toBeGreaterThan(20);
      expect(guide.inputs.length, `${guideId} inputs`).toBeGreaterThan(0);
      expect(guide.mutations.length, `${guideId} mutations`).toBeGreaterThan(0);
      expect(guide.invariants.length, `${guideId} safety guarantees`).toBeGreaterThan(0);
      expect(guide.output.length, `${guideId} output`).toBeGreaterThan(20);
      expect("diagram" in guide ? guide.diagram : undefined).toBe(expectedDiagrams[guideId]);
    }
  });

  it("renders the short summary and a closed detailed disclosure", () => {
    const html = renderToStaticMarkup(createElement(MergeStepGuide, { guideId: "select" }));

    expect(html).toContain('data-slot="merge-step-guide"');
    expect(html).toContain('data-guide-id="select"');
    expect(html).toContain('data-slot="merge-step-guide-summary"');
    expect(html).toContain(MERGE_STEP_GUIDES.select.summary);
    expect(html).toContain("How this step works");
    expect(html).toContain('aria-expanded="false"');
    expect(html).not.toContain('data-slot="merge-step-guide-details"');
  });

  it("keeps the exact-off review free of exact-reconciliation behavior", () => {
    const guide = MERGE_STEP_GUIDES["review-cumulative-without-exact"];
    const copy = [
      guide.summary,
      ...guide.inputs,
      ...guide.mutations,
      ...guide.invariants,
      guide.output,
    ].join(" ");

    expect(copy).not.toMatch(/exact[- ]reconcil/i);
    expect(copy).not.toContain("reconciled references");
    expect(guide.diagram).toBe("direct-merge");
  });

  it("renders semantic level-three headings for every detailed section", () => {
    const html = renderToStaticMarkup(
      createElement(MergeStepGuide, { defaultOpen: true, guideId: "run-all" }),
    );

    expect(html.match(/role="heading" aria-level="3"/g)).toHaveLength(5);
    for (const heading of ["Inputs", "What can change", "Safety guarantees", "Output", "Caution"]) {
      expect(html).toContain(heading);
    }
  });

  it.each(MERGE_GUIDE_DIAGRAM_IDS)("renders an accessible, responsive %s diagram", (diagram) => {
    const html = renderToStaticMarkup(createElement(MergeGuideDiagram, { diagram }));
    const fontSizes = [...html.matchAll(/font-size="([0-9]+)"/g)].map((match) => Number(match[1]));

    expect(html).toContain('role="img"');
    expect(html).toContain(`data-diagram="${diagram}"`);
    expect(html).toContain('viewBox="0 0 240 300"');
    expect(html).toContain('class="h-auto w-full max-w-full"');
    expect(html).toMatch(/aria-labelledby="[^"]+ [^"]+"/);
    expect(html).toMatch(/<title id="[^"]+">[^<]+<\/title>/);
    expect(html).toMatch(/<desc id="[^"]+">[^<]+<\/desc>/);
    expect(Math.min(...fontSizes)).toBeGreaterThanOrEqual(10);
    expect(html).not.toContain("foreignObject");
  });

  it("uses Base UI open-state styling and hides the decorative chevron", () => {
    const html = renderToStaticMarkup(
      createElement(
        Details,
        { defaultOpen: true },
        createElement(DetailsSummary, null, "Technical details"),
        createElement(DetailsContent, null, "Expanded content"),
      ),
    );

    expect(html).toContain("data-panel-open:shadow-sm");
    expect(html).toContain("group-data-panel-open:rotate-180");
    expect(html).toMatch(/<svg[^>]*aria-hidden="true"/);
    expect(html).toContain('aria-expanded="true"');
    expect(html).toContain("Expanded content");
  });
});
