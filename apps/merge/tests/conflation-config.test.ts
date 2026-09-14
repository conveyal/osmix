import { createStore, Provider } from "jotai";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { ConflationConfig } from "../src/components/conflation-config";
import {
  DEFAULT_CONFLATION_FORM_STATE,
  type ConflationFormState,
} from "../src/lib/conflation-workflow";
import { conflationFormAtom } from "../src/state/conflation";

function renderConfig(overrides: Partial<ConflationFormState> = {}) {
  const store = createStore();
  store.set(conflationFormAtom, { ...DEFAULT_CONFLATION_FORM_STATE, enabled: true, ...overrides });
  return renderToStaticMarkup(createElement(Provider, { store }, createElement(ConflationConfig)));
}

function controlWithHelp(html: string, helpId: string) {
  return [...html.matchAll(/<(?:span|input)[^>]*>/g)]
    .map(([tag]) => tag)
    .find((tag) => tag.includes(`aria-describedby="${helpId}`));
}

describe("matching settings accessibility", () => {
  it("keeps field descriptions available while optional popovers are closed", () => {
    const html = renderConfig();
    for (const helpId of [
      "conflation-enabled-help",
      "conflation-copy-help",
      "conflation-keys-help",
      "conflation-network-help",
      "conflation-removal-help",
      "conflation-distance-help",
    ]) {
      expect(controlWithHelp(html, helpId)).toBeDefined();
      expect(html).toContain(`id="${helpId}"`);
    }
    expect(html).toContain('aria-labelledby="conflation-settings-title"');
    expect(html).toContain("Find possible matches between imported features");
    expect(html).toContain("Use attribute names, separated by commas or spaces");
    expect(html).not.toContain('aria-invalid="true"');
  });

  it("associates keys and radius errors with their own controls", () => {
    const html = renderConfig({ propertyKeys: "", maxDistanceMeters: Number.NaN });
    expect(controlWithHelp(html, "conflation-keys-help")).toContain("conflation-keys-error");
    expect(controlWithHelp(html, "conflation-keys-help")).toContain('aria-invalid="true"');
    expect(controlWithHelp(html, "conflation-distance-help")).toContain(
      "conflation-distance-error",
    );
    expect(controlWithHelp(html, "conflation-distance-help")).toContain('aria-invalid="true"');
    expect(controlWithHelp(html, "conflation-copy-help")).not.toContain('aria-invalid="true"');
    expect(html).toContain('id="conflation-keys-error"');
    expect(html).toContain('id="conflation-distance-error"');
    expect(html).not.toContain('value="NaN"');
  });

  it("describes the missing-action error on every choice without invalidating disabled keys", () => {
    const html = renderConfig({
      transferProperties: false,
      attachNetwork: false,
      propertyKeys: "",
    });
    for (const helpId of [
      "conflation-copy-help",
      "conflation-network-help",
      "conflation-removal-help",
    ]) {
      expect(controlWithHelp(html, helpId)).toContain("conflation-actions-error");
      expect(controlWithHelp(html, helpId)).toContain('aria-invalid="true"');
    }
    expect(html).toContain('id="conflation-actions-error"');
    expect(html).not.toContain('id="conflation-keys-error"');
    expect(controlWithHelp(html, "conflation-keys-help")).not.toContain('aria-invalid="true"');
  });

  it("keeps geometry removal off and explains its manual preview requirement", () => {
    const html = renderConfig();
    const removal = controlWithHelp(html, "conflation-removal-help");
    expect(removal).toContain('aria-checked="false"');
    expect(html).toContain("Review redundant way removal");
    expect(html).toContain("Manual review only.");
    expect(html).toContain("No geometry is removed automatically.");
    const removalOnly = renderConfig({
      transferProperties: false,
      allowWayRemoval: true,
      propertyKeys: "",
    });
    expect(removalOnly).not.toContain('aria-invalid="true"');
  });
});
