import { describe, expect, it } from "vitest";

import {
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
});
