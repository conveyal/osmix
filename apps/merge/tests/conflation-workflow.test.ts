import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import {
  ConflationBulkActions,
  ConflationResultsHeader,
} from "../src/components/conflation-review";
import {
  conflationBulkActionCopy,
  conflationFormErrors,
  DEFAULT_CONFLATION_FORM_STATE,
  DEFAULT_CONFLATION_PROPERTY_KEYS,
  firstInvalidConflationInputId,
  parseConflationPropertyKeys,
  toOsmConflationOptions,
  validateConflationForm,
} from "../src/lib/conflation-workflow";

describe("conflation workflow configuration", () => {
  it("links independent setting errors to the first input that needs correction", () => {
    const invalid = {
      ...DEFAULT_CONFLATION_FORM_STATE,
      enabled: true,
      propertyKeys: " , ",
      maxDistanceMeters: Number.NaN,
    };
    expect(conflationFormErrors(invalid)).toEqual({
      maxDistanceMeters: "Match distance must be greater than zero.",
      propertyKeys: "Enter at least one OSM tag key to copy.",
    });
    expect(firstInvalidConflationInputId(invalid)).toBe("conflation-property-keys");
    expect(firstInvalidConflationInputId({ ...invalid, propertyKeys: "name" })).toBe(
      "conflation-distance",
    );
    const correctedRadius = { ...invalid, maxDistanceMeters: 0.001 };
    expect(firstInvalidConflationInputId(correctedRadius)).toBe("conflation-property-keys");
    const noActions = { ...correctedRadius, transferProperties: false };
    expect(conflationFormErrors(noActions)).toEqual({
      actions: "Select Copy tags, Connect network, or Review redundant way removal.",
    });
    expect(firstInvalidConflationInputId(noActions)).toBe("conflation-property-transfer");
    expect(firstInvalidConflationInputId({ ...noActions, attachNetwork: true })).toBeNull();
    expect(conflationFormErrors({ ...invalid, enabled: false })).toEqual({});
    expect(firstInvalidConflationInputId({ ...invalid, enabled: false })).toBeNull();
  });

  it("keeps fuzzy matching disabled by default", () => {
    expect(DEFAULT_CONFLATION_FORM_STATE).toEqual({
      enabled: false,
      transferProperties: true,
      propertyKeys: "barrier, crossing, kerb, tactile_paving",
      attachNetwork: false,
      allowWayRemoval: false,
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
    ).toBe("Select Copy tags, Connect network, or Review redundant way removal.");
  });

  it("requires explicit property keys when property transfer is enabled", () => {
    expect(
      validateConflationForm({
        ...DEFAULT_CONFLATION_FORM_STATE,
        enabled: true,
        propertyKeys: "",
      }),
    ).toBe("Enter at least one OSM tag key to copy.");
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

  it("enables removal review without scheduling copying or connections", () => {
    const state = {
      ...DEFAULT_CONFLATION_FORM_STATE,
      enabled: true,
      transferProperties: false,
      propertyKeys: "",
      allowWayRemoval: true,
    };
    expect(validateConflationForm(state)).toBeNull();
    expect(toOsmConflationOptions(state)).toEqual({
      propertyKeys: [],
      attachNetwork: false,
      allowWayRemoval: true,
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
      buttonLabel: "Copy tags",
      title: "Copy tags for filtered matches?",
    });
    expect(conflationBulkActionCopy("attach-network")).toMatchObject({
      buttonLabel: "Connect network",
      title: "Connect the filtered imported network?",
    });
    expect(conflationBulkActionCopy("reject")).toEqual({
      buttonLabel: "Skip filtered",
      confirmLabel: "Skip filtered matches",
      description:
        "Schedule no matching actions for the filtered matches. Keep ordinary imported additions, including blocked and unmatched features.",
      title: "Skip all filtered matches?",
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

    expect(html).toContain("Bulk decisions");
    expect(html).toContain('aria-label="About bulk decisions"');
    expect(html).not.toContain("every match in the current filters across all pages");
    expect(html).toContain("Copy tags (145)");
    expect(html).toContain("Connect network (12)");
    expect(html).toMatch(/<button[^>]*disabled=""[^>]*>Skip filtered \(0\)<\/button>/);
  });

  it("marks previous filtered results stale while the worker refreshes them", () => {
    const html = renderToStaticMarkup(
      createElement(ConflationResultsHeader, {
        isFilterPending: true,
        totalCandidates: 987_654,
      }),
    );

    expect(html).toContain("Filtered matches (987,654, stale)");
    expect(html).toContain("Updating filters…");
    expect(html).toContain('role="status"');
    expect(html).toContain('aria-live="polite"');
  });
});
