import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { ConflationBulkActions } from "../src/components/conflation-review";
import {
  conflationBulkActionCopy,
  DEFAULT_CONFLATION_FORM_STATE,
  DEFAULT_CONFLATION_PROPERTY_KEYS,
  parseConflationPropertyKeys,
  toOsmConflationOptions,
  validateConflationForm,
} from "../src/lib/conflation-workflow";

describe("conflation workflow configuration", () => {
  it("keeps fuzzy matching disabled by default", () => {
    expect(DEFAULT_CONFLATION_FORM_STATE).toEqual({
      enabled: false,
      transferProperties: true,
      propertyKeys: "barrier, crossing, kerb, tactile_paving",
      attachNetwork: false,
      maxDistanceMeters: 1,
    });
    expect(parseConflationPropertyKeys(DEFAULT_CONFLATION_FORM_STATE.propertyKeys)).toEqual([
      ...DEFAULT_CONFLATION_PROPERTY_KEYS,
    ]);
    expect(validateConflationForm(DEFAULT_CONFLATION_FORM_STATE)).toBeNull();
  });

  it("normalizes explicit property keys", () => {
    expect(parseConflationPropertyKeys("name, surface  name\noperator")).toEqual([
      "name",
      "operator",
      "surface",
    ]);
  });

  it("requires at least one selected operation", () => {
    expect(
      validateConflationForm({
        ...DEFAULT_CONFLATION_FORM_STATE,
        enabled: true,
        transferProperties: false,
      }),
    ).toBe("Enable property transfer, network attachment, or both.");
  });

  it("requires explicit property keys when property transfer is enabled", () => {
    expect(
      validateConflationForm({
        ...DEFAULT_CONFLATION_FORM_STATE,
        enabled: true,
        propertyKeys: "",
      }),
    ).toBe("Enter at least one property key to transfer.");
  });

  it("accepts network-only matching without property keys", () => {
    const state = {
      ...DEFAULT_CONFLATION_FORM_STATE,
      enabled: true,
      transferProperties: false,
      attachNetwork: true,
    };
    expect(validateConflationForm(state)).toBeNull();
    expect(toOsmConflationOptions(state)).toEqual({
      propertyKeys: [],
      attachNetwork: true,
      maxDistanceMeters: 1,
      automatic: "high-confidence",
    });
  });

  it("builds explicit high-confidence property-transfer options", () => {
    expect(
      toOsmConflationOptions({
        ...DEFAULT_CONFLATION_FORM_STATE,
        enabled: true,
        propertyKeys: "operator, name operator",
      }),
    ).toEqual({
      propertyKeys: ["name", "operator"],
      attachNetwork: false,
      maxDistanceMeters: 1,
      automatic: "high-confidence",
    });
  });

  it("rejects invalid match distances", () => {
    expect(
      validateConflationForm({
        ...DEFAULT_CONFLATION_FORM_STATE,
        enabled: true,
        maxDistanceMeters: 0,
      }),
    ).toBe("Match distance must be greater than zero.");
  });

  it("uses action-specific labels and explicit filter-wide confirmation wording", () => {
    expect(conflationBulkActionCopy("transfer-properties")).toMatchObject({
      buttonLabel: "Transfer properties",
      title: "Transfer properties to filtered matches?",
    });
    expect(conflationBulkActionCopy("attach-network")).toMatchObject({
      buttonLabel: "Attach network",
      title: "Attach the filtered imported network?",
    });
    expect(conflationBulkActionCopy("reject")).toEqual({
      buttonLabel: "Reject filtered",
      confirmLabel: "Reject filtered matches",
      description:
        "Reject every filtered match that is not already rejected, including blocked and unmatched rows.",
      title: "Reject all filtered matches?",
    });
  });

  it("renders filter-wide counts and disables actions with no decisions to change", () => {
    const preview = {
      action: "transfer-properties" as const,
      filteredCandidates: 145,
      eligibleCandidates: 145,
      changedCandidates: 145,
      skippedCandidates: 0,
      automaticCandidates: 145,
      reviewCandidates: 0,
      overriddenDecisions: 0,
    };
    const html = renderToStaticMarkup(
      createElement(ConflationBulkActions, {
        bulkActions: {
          "transfer-properties": preview,
          "attach-network": {
            ...preview,
            action: "attach-network",
            changedCandidates: 12,
          },
          reject: {
            ...preview,
            action: "reject",
            changedCandidates: 0,
          },
        },
        filter: { status: "automatic" },
        onBulkDecision: async () => {},
      }),
    );

    expect(html).toContain("every match in the current filters across all pages");
    expect(html).toContain("Automatic matches already apply unless rejected");
    expect(html).toContain("Transfer properties (145)");
    expect(html).toContain("Attach network (12)");
    expect(html).toMatch(/<button[^>]*disabled=""[^>]*>Reject filtered \(0\)<\/button>/);
  });
});
