import { osmFileSizeGuidance } from "@osmix/app-core";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import { OsmFileSizeWarning } from "../src/components/osm-file-size-warning.tsx";

function warningFor(bytes: number) {
  const guidance = osmFileSizeGuidance(bytes, 8 * 2 ** 30);
  if (guidance.level === "full") throw Error("expected a warning");
  return guidance;
}

describe("OSM file size warning", () => {
  it("offers Extract, Load anyway and Cancel for a file too large to load", () => {
    const html = renderToStaticMarkup(
      createElement(OsmFileSizeWarning, {
        fileName: "italy.osm.pbf",
        guidance: warningFor(2_211_033_554),
        onCancel: vi.fn(),
        onLoadAnyway: vi.fn(),
        onOpenInExtract: vi.fn(),
      }),
    );
    expect(html).toContain('role="alert"');
    expect(html).toContain("This file is probably too large to load");
    expect(html).toContain("italy.osm.pbf");
    expect(html).toContain("Open in Extract");
    expect(html).toContain("Load anyway");
    expect(html).toContain("Cancel");
  });

  it("is a passive warning for a View-sized file, without Extract when none is offered", () => {
    const html = renderToStaticMarkup(
      createElement(OsmFileSizeWarning, {
        fileName: "australia.osm.pbf",
        guidance: warningFor(952_642_672),
        onCancel: vi.fn(),
        onLoadAnyway: vi.fn(),
      }),
    );
    expect(html).not.toContain('role="alert"');
    expect(html).toContain("This file will probably load in View mode");
    expect(html).not.toContain("Open in Extract");
  });
});
