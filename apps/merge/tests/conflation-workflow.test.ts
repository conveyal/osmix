import type { OsmConflationCandidateView } from "osmix";
import { describe, expect, it } from "vitest";

import {
  DEFAULT_CONFLATION_FORM_STATE,
  parseConflationPropertyKeys,
  toAutomaticPropertyOnlyDecision,
  toOsmConflationOptions,
  validateConflationForm,
} from "../src/lib/conflation-workflow";

describe("conflation workflow configuration", () => {
  it("keeps fuzzy matching disabled by default", () => {
    expect(DEFAULT_CONFLATION_FORM_STATE).toEqual({
      enabled: false,
      transferProperties: true,
      propertyKeys: "",
      attachNetwork: false,
      maxDistanceMeters: 1,
    });
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
    expect(validateConflationForm({ ...DEFAULT_CONFLATION_FORM_STATE, enabled: true })).toBe(
      "Enter at least one property key to transfer.",
    );
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

  it("bulk-confirms only automatic non-routing property-only candidates", () => {
    const candidate: OsmConflationCandidateView = {
      id: "node:-1->1",
      entityType: "node",
      sourceId: -1,
      targetId: 1,
      status: "automatic",
      reasons: [],
      propertyTransfer: { status: "automatic", reasons: [] },
      networkAttachment: null,
      evidence: {
        distanceMeters: 0.5,
        sourceRoutingFamilies: ["non-routable"],
        targetRoutingFamilies: ["non-routable"],
        tagDiff: [
          {
            key: "name",
            patchValue: "Imported name",
            protected: false,
            routing: false,
          },
        ],
      },
    };

    expect(toAutomaticPropertyOnlyDecision(candidate)).toEqual({
      candidateId: candidate.id,
      action: "accept",
      transferProperties: true,
      attachNetwork: false,
    });
    expect(
      toAutomaticPropertyOnlyDecision({
        ...candidate,
        networkAttachment: { status: "automatic", reasons: [] },
      }),
    ).toBeNull();
  });

  it.each(["accept", "reject"] as const)(
    "does not bulk-confirm a candidate with an existing %s decision",
    (action) => {
      const candidate: OsmConflationCandidateView = {
        id: "node:-1->1",
        entityType: "node",
        sourceId: -1,
        targetId: 1,
        status: "automatic",
        reasons: [],
        propertyTransfer: { status: "automatic", reasons: [] },
        networkAttachment: null,
        evidence: {
          distanceMeters: 0.5,
          sourceRoutingFamilies: ["non-routable"],
          targetRoutingFamilies: ["non-routable"],
          tagDiff: [
            {
              key: "name",
              patchValue: "Imported name",
              protected: false,
              routing: false,
            },
          ],
        },
        decision: { candidateId: "node:-1->1", action },
      };

      expect(toAutomaticPropertyOnlyDecision(candidate)).toBeNull();
    },
  );
});
