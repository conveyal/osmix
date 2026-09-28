import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { ConflationWayRemovalPreview } from "../src/components/conflation-way-removal";
import { createWayRemovalSession } from "./fixtures/way-removal";

describe("imported-way removal in a plan", () => {
  it("waits for the connections a branching trunk needs before removal", () => {
    const { worker, base } = createWayRemovalSession({ branch: true });
    const removal = worker
      .getMergePlanFeature(base.id, "way:20")
      .proposals.find((proposal) => proposal.kind === "remove-way");
    expect(removal).toMatchObject({
      status: "blocked",
      reasons: expect.arrayContaining(["way-removal-connection-required"]),
    });
  });

  it("reports an applied removal with its counterpart, cleanup and connections", () => {
    const { overview } = createWayRemovalSession({
      branch: true,
      decisions: [
        { proposalId: "connect:n101>n1", action: "accept" },
        { proposalId: "connect:n102>n2", action: "accept" },
        { proposalId: "remove:w20>w10", action: "accept" },
      ],
    });
    const outcome = overview.matching?.outcome;
    if (!outcome) throw Error("Expected a matching outcome");
    const html = renderToStaticMarkup(
      createElement(ConflationWayRemovalPreview, { outcome, applied: true }),
    );
    expect(html).toContain('aria-label="Applied way removals"');
    expect(html).toContain("Removed imported ways: 1");
    expect(html).toContain("Removed imported way 20; retained base way 10.");
    expect(html).toContain("Explicit network connection applied.");
  });
});
