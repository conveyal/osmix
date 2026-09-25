import { createStore, Provider } from "jotai";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { AUTOMATIC_LABEL, MergeStart } from "../src/components/merge-start";
import { automaticMergeAtom } from "../src/state/conflation";

function render({
  automatic = false,
  matchingEnabled = false,
  requiresRemovalReview = false,
}: {
  automatic?: boolean;
  matchingEnabled?: boolean;
  requiresRemovalReview?: boolean;
}) {
  const store = createStore();
  store.set(automaticMergeAtom, automatic);
  return renderToStaticMarkup(
    createElement(
      Provider,
      { store },
      createElement(MergeStart, {
        disabled: false,
        matchingEnabled,
        onStart: () => {},
        requiresRemovalReview,
      }),
    ),
  );
}

describe("MergeStart", () => {
  it("offers one Start merge button and a self-explanatory checkbox", () => {
    const html = render({});
    expect(html.match(/<button[^>]*data-slot="button"/g)).toHaveLength(1);
    expect(html).toContain("Start merge");
    expect(html).toContain(AUTOMATIC_LABEL);
    // The details of what runs live in the tooltip, which renders only when open.
    expect(html).not.toContain("Skips the duplicate diagnostics");
    expect(html).not.toContain("Unavailable while redundant way removal review is on");
  });

  it("disables the checkbox with a visible reason while removal review is on", () => {
    const html = render({ automatic: true, matchingEnabled: true, requiresRemovalReview: true });
    expect(html).toContain("Unavailable while redundant way removal review is on");
    // Base UI puts the id on its hidden native input, which mirrors checked and disabled.
    const input = html.match(/<input[^>]*id="automatic-mode"[^>]*>/)?.[0] ?? "";
    expect(input).toContain('disabled=""');
    expect(input).not.toMatch(/\schecked=""/);
  });
});
