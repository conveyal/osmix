import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { OsmInputCardHeader } from "../src/components/osm-input-card-header";

const noop = async () => undefined;

function render(props: Partial<Parameters<typeof OsmInputCardHeader>[0]> = {}) {
  return renderToStaticMarkup(
    createElement(OsmInputCardHeader, {
      kind: "patch",
      loaded: true,
      onClear: noop,
      onDownload: noop,
      title: "Patch OSM",
      ...props,
    }),
  );
}

const useAsBase = (html: string) => html.match(/<button[^>]*aria-label="Use as base"[^>]*>/g) ?? [];
/** The attribute, not the `disabled:` class variants every button carries. */
const isDisabled = (button: string) => /\sdisabled=""/.test(button);

describe("OsmInputCardHeader", () => {
  it("offers one enabled Use as base on a patch card with a handler", () => {
    const buttons = useAsBase(render({ onUseAsBase: noop }));
    expect(buttons).toHaveLength(1);
    expect(isDisabled(buttons[0] ?? "")).toBe(false);
  });

  it("disables Use as base while the base slot is occupied", () => {
    const buttons = useAsBase(render({ onUseAsBase: noop, canUseAsBase: false }));
    expect(buttons).toHaveLength(1);
    expect(isDisabled(buttons[0] ?? "")).toBe(true);
  });

  it("has no Use as base on a base card or without a handler", () => {
    expect(useAsBase(render({ kind: "base", onUseAsBase: noop }))).toHaveLength(0);
    expect(useAsBase(render())).toHaveLength(0);
  });

  it("keeps the download and clear actions", () => {
    const html = render({ onUseAsBase: noop });
    expect(html).toContain('aria-label="Download patch OSM"');
    expect(html).toContain('aria-label="Clear patch OSM file"');
  });
});
