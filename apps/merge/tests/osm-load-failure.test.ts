import { describeOsmLoadFailure } from "@osmix/app-core";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import { OsmLoadFailurePanel } from "../src/components/osm-load-failure.tsx";

function structuredError(fields: Record<string, unknown>): Error {
  const message = typeof fields["message"] === "string" ? fields["message"] : "load failed";
  return Object.assign(new Error(message), fields);
}

describe("OSM load failure panel", () => {
  it("renders an accessible persistent panel with technical details and actions", () => {
    const failure = describeOsmLoadFailure(
      structuredError({
        code: "OSM_LOAD_CAPACITY_EXCEEDED",
        requiredBytes: 1_800,
        availableBytes: 1_600,
        suggestedProfile: "view",
      }),
      { sourceName: "large.pbf", allowViewRetry: true },
    );
    const html = renderToStaticMarkup(
      createElement(OsmLoadFailurePanel, {
        failure,
        onDismiss: vi.fn(),
        onReloadView: vi.fn(),
      }),
    );

    expect(html).toContain('role="alert"');
    expect(html).toContain('aria-live="assertive"');
    expect(html).toContain("Could not load large.pbf");
    expect(html).toContain("Reload using View");
    expect(html).toContain("Dismiss");
    expect(html).toContain("Technical details");
    expect(html).toContain("Required Bytes");
  });
});
