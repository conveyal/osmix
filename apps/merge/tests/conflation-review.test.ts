import { createStore, Provider } from "jotai";
import { Osm, type OsmConflationCandidateView } from "osmix";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { ConflationReview } from "../src/components/conflation-review";

describe("conflation review safety status", () => {
  it("keeps a blocked candidate visibly blocked after a saved acceptance", () => {
    const candidate: OsmConflationCandidateView = {
      id: "way:20->10",
      entityType: "way",
      sourceId: 20,
      targetId: 10,
      status: "blocked",
      reasons: ["grade-conflict", "relation-member"],
      propertyTransfer: { status: "blocked", reasons: ["grade-conflict", "relation-member"] },
      networkAttachment: null,
      decision: {
        candidateId: "way:20->10",
        action: "accept",
        transferProperties: true,
        attachNetwork: false,
      },
      evidence: {
        distanceMeters: 0.5,
        sourceRoutingFamilies: ["pedestrian"],
        targetRoutingFamilies: ["pedestrian"],
        tagDiff: [{ key: "name", patchValue: "Imported bridge", protected: false, routing: false }],
      },
    };
    const ineligible = {
      filteredCandidates: 1,
      eligibleCandidates: 0,
      changedCandidates: 0,
      skippedCandidates: 1,
      automaticCandidates: 0,
      reviewCandidates: 0,
      overriddenDecisions: 0,
    };
    const html = renderToStaticMarkup(
      createElement(
        Provider,
        { store: createStore() },
        createElement(ConflationReview, {
          base: new Osm({ id: "base" }),
          patch: new Osm({ id: "patch" }),
          summary: {
            total: 1,
            accepted: 0,
            automatic: 0,
            blocked: 1,
            rejected: 0,
            review: 0,
            unmatched: 0,
          },
          page: {
            candidates: [candidate],
            page: 0,
            pageSize: 20,
            totalCandidates: 1,
            totalPages: 1,
            bulkActions: {
              "transfer-properties": { ...ineligible, action: "transfer-properties" },
              "attach-network": { ...ineligible, action: "attach-network" },
              reject: {
                ...ineligible,
                action: "reject",
                eligibleCandidates: 1,
                changedCandidates: 1,
                skippedCandidates: 0,
              },
            },
          },
          filter: { status: "blocked" },
          isFilterPending: false,
          onDecision: async () => {},
          onResetDecision: async () => {},
          onLeaveUnmatched: async () => {},
          onBulkDecision: async () => {},
          onFilterChange: async () => {},
          onPageChange: async () => {},
        }),
      ),
    );

    // Accepted remains a valid summary/filter label; inspect the actual candidate row.
    const rowDescription = html.match(
      /<p[^>]*data-slot="item-description"[^>]*>([\s\S]*?)<\/p>/,
    )?.[1];
    expect(rowDescription).toContain("Blocked; 0.500 m");
    expect(rowDescription).not.toContain("Accepted");
    expect(html).toMatch(/<button[^>]*disabled=""[^>]*>Copy tags \(0\)<\/button>/);
    expect(html).not.toMatch(/<button[^>]*>Copy tags<\/button>/);
    expect(html).not.toContain("Transfer + attach");
  });
});
