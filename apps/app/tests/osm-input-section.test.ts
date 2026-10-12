import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { OsmInputSection } from "../src/components/osm-input-section";

const noop = async () => undefined;

function render(props: Partial<Parameters<typeof OsmInputSection>[0]> = {}) {
  return renderToStaticMarkup(
    createElement(OsmInputSection, {
      kind: "patch",
      loaded: true,
      onClear: noop,
      onDownload: noop,
      title: "Patch OSM",
      ...props,
    }),
  );
}

const swap = (html: string) =>
  html.match(/<button[^>]*aria-label="Swap base and patch"[^>]*>/g) ?? [];

describe("OsmInputSection", () => {
  it("offers one Swap base and patch on a section with a handler", () => {
    expect(swap(render({ onSwap: noop }))).toHaveLength(1);
    expect(swap(render())).toHaveLength(0);
  });

  it("offers the swap while its own slot is empty, without the file actions", () => {
    const html = render({ loaded: false, onSwap: noop });
    expect(swap(html)).toHaveLength(1);
    expect(html).not.toContain('aria-label="Export patch OSM as PBF"');
    expect(html).not.toContain('aria-label="Clear patch OSM file"');
  });

  it("has no actions while empty without a swap", () => {
    expect(render({ loaded: false })).not.toContain("<button");
  });

  it("keeps the download and clear actions", () => {
    const html = render({ onSwap: noop });
    expect(html).toContain('aria-label="Export patch OSM as PBF"');
    expect(html).toContain('aria-label="Clear patch OSM file"');
  });
});
