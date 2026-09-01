import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import {
  AutomaticMergeProgress,
  CONFLATION_AUTOMATIC_MERGE_STEPS,
  EXACT_AUTOMATIC_MERGE_STEPS,
} from "../src/components/automatic-merge-progress";

describe("automatic merge progress", () => {
  it("marks earlier exact steps complete and the active step as running", () => {
    const html = renderToStaticMarkup(
      createElement(AutomaticMergeProgress, {
        currentStepId: "refresh-result",
        steps: EXACT_AUTOMATIC_MERGE_STEPS,
      }),
    );

    expect(html).toContain('aria-label="Automatic merge progress"');
    expect(html).toContain('data-status="completed"');
    expect(html).toContain('aria-current="step"');
    expect(html).toContain("Merge, reconcile, and create intersections");
    expect(html).toContain("Refresh merged dataset");
    expect(html).toContain("1 of 2 steps completed");
  });

  it("distinguishes completed, running, and remaining conflation stages", () => {
    const html = renderToStaticMarkup(
      createElement(AutomaticMergeProgress, {
        currentStepId: "apply-verified-merge",
        elapsedMs: 582_000,
        latestMessage: "Applying verified imported-data changes",
        steps: CONFLATION_AUTOMATIC_MERGE_STEPS,
      }),
    );

    expect(html.match(/data-status="completed"/g)).toHaveLength(2);
    expect(html.match(/data-status="running"/g)).toHaveLength(1);
    expect(html.match(/data-status="remaining"/g)).toHaveLength(2);
    expect(html).toContain("Apply verified merge changes is running");
    expect(html).toContain("2 of 5 steps completed");
    expect(html).toContain("9:42");
    expect(html).toContain("Applying verified imported-data changes");
    expect(html).not.toContain('role="progressbar"');
  });
});
