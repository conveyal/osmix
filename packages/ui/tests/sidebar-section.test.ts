import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { SidebarSection } from "../src/components/sidebar-section.tsx";
import { Step } from "../src/components/step.tsx";
import { Item } from "../src/components/ui/item.tsx";

const content = (html: string) =>
  html.match(/data-slot="sidebar-section-content" class="([^"]*)"/)?.[1] ?? "";

describe("SidebarSection", () => {
  it("is a region named by its title", () => {
    const html = renderToStaticMarkup(createElement(SidebarSection, { title: "Plan" }, "Body"));
    const titleId = html.match(/<section[^>]*aria-labelledby="([^"]+)"/)?.[1];
    expect(titleId).toBeTruthy();
    expect(html).toMatch(new RegExp(`<h2 id="${titleId}"[^>]*>.*Plan`));
  });

  it("takes an explicit name instead of its title", () => {
    const html = renderToStaticMarkup(
      createElement(SidebarSection, { title: "Merge complete", "aria-label": "Summary" }),
    );
    expect(html).toContain('aria-label="Summary"');
    expect(html).not.toContain("aria-labelledby");
  });

  it("pads its body by the inset unless flush", () => {
    const padded = renderToStaticMarkup(createElement(SidebarSection, { title: "A" }, "Body"));
    const flush = renderToStaticMarkup(
      createElement(SidebarSection, { title: "A", flush: true }, "Body"),
    );
    expect(content(padded)).toContain("px-inset");
    expect(content(flush)).not.toContain("inset");
  });

  it("is flat: a divider and no box", () => {
    const html = renderToStaticMarkup(createElement(SidebarSection, { title: "A" }));
    const section = html.match(/<section[^>]*class="([^"]*)"/)?.[1] ?? "";
    expect(section).toContain("border-b");
    expect(section).not.toMatch(/\brounded|\bbg-/);
  });
});

describe("Step", () => {
  it("numbers the section title", () => {
    const html = renderToStaticMarkup(createElement(Step, { number: 2, title: "Review" }));
    expect(html).toContain('data-slot="sidebar-section-number"');
    expect(html).toMatch(/2\.<\/span>.*Review/);
  });
});

describe("row items", () => {
  it("are divided rows tinted when current", () => {
    const html = renderToStaticMarkup(
      createElement(Item, { variant: "row", "aria-current": "true" }, "Row"),
    );
    const classes = html.match(/class="([^"]*)"/)?.[1] ?? "";
    expect(classes).toContain("border-b");
    expect(classes).toContain("aria-current:bg-muted");
    expect(classes).toContain("px-inset");
    expect(classes).toContain("rounded-none");
  });
});
