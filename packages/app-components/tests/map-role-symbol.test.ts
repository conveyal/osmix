import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { MapRoleSymbol } from "../src/components/map-role-symbol.tsx";

type SymbolProps = Parameters<typeof MapRoleSymbol>[0] & Record<`data-${string}`, string>;

function markup(props: SymbolProps): string {
  return renderToStaticMarkup(createElement(MapRoleSymbol, props));
}

describe("MapRoleSymbol", () => {
  it("draws the key entries with a line by default", () => {
    const base = markup({ role: "base" });
    expect(base).toContain('data-variant="line"');
    expect(base).toContain("<line");
    expect(base).toContain("<circle");
    expect(base).toContain('fill="var(--map-base)"');
    expect(base).not.toContain("stroke-dasharray");

    const patch = markup({ role: "patch" });
    expect(patch).toContain("<line");
    expect(patch).toContain("stroke-dasharray");
    expect(patch).toContain("<path");
    expect(patch).not.toContain("<circle");
  });

  it("draws point markers that stay distinguishable when co-located", () => {
    const base = markup({ role: "base", variant: "point" });
    expect(base).toContain('data-variant="point"');
    expect(base).not.toContain("<line");
    expect(base).toContain("<circle");
    // A hollow ring: the diamond shows through it at the same location.
    expect(base).toContain('fill="none"');
    expect(base).not.toContain('fill="var(--map-base)"');

    const patch = markup({ role: "patch", variant: "point" });
    expect(patch).not.toContain("<line");
    expect(patch).not.toContain("<circle");
    expect(patch).toContain('<path d="M14 7 21 14 14 21 7 14Z" fill="var(--map-patch)"');
  });

  it("is decorative and passes through size and data attributes", () => {
    const svg = markup({ role: "base", size: 28, "data-slot": "marker", "data-role": "target" });
    expect(svg).toContain('aria-hidden="true"');
    expect(svg).toContain('width="28" height="28"');
    expect(svg).toContain('data-slot="marker"');
    expect(svg).toContain('data-role="target"');
  });
});
