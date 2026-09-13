import { createStore, Provider } from "jotai";
import { Osm, type OsmConflationCandidateView } from "osmix";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { ConflationReview } from "../src/components/conflation-review";

describe("conflation review safety status", () => {
  it.each(["grade-conflict", "feature-type-conflict"] as const)(
    "keeps %s visibly blocked after a saved acceptance and additional review reason",
    (reason) => {
      const entityType = reason === "feature-type-conflict" ? "node" : "way";
      const candidateId = `${entityType}:20->10`;
      const candidate: OsmConflationCandidateView = {
        id: candidateId,
        entityType,
        sourceId: 20,
        targetId: 10,
        status: "blocked",
        reasons: [reason, "relation-member"],
        propertyTransfer: { status: "blocked", reasons: [reason, "relation-member"] },
        networkAttachment:
          reason === "feature-type-conflict" ? { status: "blocked", reasons: [reason] } : null,
        decision: {
          candidateId,
          action: "accept",
          transferProperties: true,
          attachNetwork: reason === "feature-type-conflict",
        },
        evidence: {
          distanceMeters: 0.5,
          sourceRoutingFamilies: ["pedestrian"],
          targetRoutingFamilies: ["pedestrian"],
          tagDiff: [
            {
              key: "name",
              patchValue: reason === "feature-type-conflict" ? "School" : "Imported bridge",
              protected: false,
              routing: false,
            },
          ],
          ...(reason === "feature-type-conflict"
            ? {
                featureTypeConflicts: [{ key: "amenity", baseValue: "cafe", patchValue: "school" }],
              }
            : {}),
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

      // Inspect the candidate itself, separately from the summary and status filter.
      const rowDescription = html.match(
        /<p[^>]*data-slot="item-description"[^>]*>([\s\S]*?)<\/p>/,
      )?.[1];
      expect(rowDescription).toContain("Blocked; 0.500 m");
      expect(rowDescription).not.toContain("Accepted");
      expect(html).toMatch(/<button[^>]*disabled=""[^>]*>Copy tags \(0\)<\/button>/);
      expect(html).not.toMatch(/<button[^>]*>Copy tags<\/button>/);
      expect(html).not.toContain("Transfer + attach");
      expect(html.match(/<[a-z]+[^>]*role="checkbox"[^>]*>/)?.[0]).toContain(
        'aria-disabled="true"',
      );
      expect(html).toContain(
        `aria-label="Compare imported ${entityType} 20 with base ${entityType} 10"`,
      );
      expect(html).toContain('aria-pressed="false"');
      expect(html).toContain("Nodes are points; ways are ordered point sequences");
      expect(html).toMatch(/<div[^>]*role="group"[^>]*aria-label="Imported features"/);
      const filterDescription = html.match(
        /<select[^>]*id="conflation-status-filter"[^>]*aria-describedby="([^"]+)"/,
      )?.[1];
      expect(filterDescription).toBeTruthy();
      expect(html).toContain(`id="${filterDescription}"`);
      expect(html).toContain("bulk choices affect matching rows only");
      if (reason === "feature-type-conflict") {
        expect(rowDescription).toContain("Feature classifications conflict");
        expect(html).toContain(
          '<option value="feature-type-conflict">Feature classifications conflict</option>',
        );
        const actionControls = html.match(/<[a-z]+[^>]*role="checkbox"[^>]*>/g) ?? [];
        expect(actionControls).toHaveLength(2);
        for (const control of actionControls) expect(control).toContain('aria-disabled="true"');
        expect(html).toContain('aria-label="Feature type conflict"');
        expect(html).toContain("cafe");
        expect(html).toContain("school");
      }
    },
  );
});
