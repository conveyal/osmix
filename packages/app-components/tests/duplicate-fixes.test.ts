import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { DUPLICATE_SCAN_GUIDE, DuplicateScanGuide } from "../src/components/duplicate-fixes.tsx";

describe("DuplicateScanGuide", () => {
  it("renders a closed disclosure by default", () => {
    const html = renderToStaticMarkup(createElement(DuplicateScanGuide));
    expect(html).toContain("How this scan works");
    expect(html).toContain('aria-expanded="false"');
    expect(html).not.toContain('data-slot="duplicate-scan-guide"');
  });

  it("explains what the scan finds, what applying changes, and what stays the same", () => {
    const html = renderToStaticMarkup(createElement(DuplicateScanGuide, { defaultOpen: true }));
    expect(html.match(/role="heading" aria-level="3"/g)).toHaveLength(3);
    for (const heading of ["What it finds", "What applying changes", "What stays the same"]) {
      expect(html).toContain(heading);
    }
    for (const item of [
      ...DUPLICATE_SCAN_GUIDE.finds,
      ...DUPLICATE_SCAN_GUIDE.applies,
      ...DUPLICATE_SCAN_GUIDE.keeps,
    ]) {
      expect(html).toContain(item);
    }
    expect(html).toContain(DUPLICATE_SCAN_GUIDE.caution);
  });

  it("describes a single dataset rather than merge inputs", () => {
    const copy = Object.values(DUPLICATE_SCAN_GUIDE).flat().join(" ");
    expect(copy).not.toMatch(/\b(base|patch)\b/i);
    expect(copy).toMatch(/highest ID/);
  });
});
