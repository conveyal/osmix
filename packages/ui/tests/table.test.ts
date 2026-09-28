import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { TableCell, TableHead } from "../src/components/ui/table.tsx";

describe("numeric table cells", () => {
  it("right-aligns numeric cells and headings and marks them", () => {
    const cell = renderToStaticMarkup(createElement(TableCell, { numeric: true }, "1,234"));
    const head = renderToStaticMarkup(createElement(TableHead, { numeric: true }, "Count"));
    for (const html of [cell, head]) {
      expect(html).toContain('data-numeric="true"');
      expect(html).toMatch(/class="[^"]*\btext-right\b/);
    }
  });

  it("leaves text cells left-aligned", () => {
    const html = renderToStaticMarkup(createElement(TableCell, null, "monaco.pbf"));
    expect(html).not.toContain("data-numeric");
    expect(html).not.toContain("text-right");
  });
});
