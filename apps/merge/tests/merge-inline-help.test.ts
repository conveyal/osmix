import { createStore, Provider } from "jotai";
import type { OsmConflationCandidateView, OsmConflationRoutingDiagnostics } from "osmix";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

vi.mock("../src/state/worker", () => ({
  osmWorker: {
    getChangesetPage: vi.fn(),
    setChangesetFilters: vi.fn(),
  },
}));

import { ConflationConfig } from "../src/components/conflation-config";
import {
  CandidateActionStatuses,
  CandidateActions,
  CandidateEvidence,
  conflationCandidateTitle,
  conflationReasonLabel,
  ConflationStatusLegend,
} from "../src/components/conflation-review";
import { ConflationRoutingDiagnostics } from "../src/components/conflation-routing-diagnostics";
import ChangesSummary, { ChangesFilters } from "../src/components/osm-changes-summary";
import { changesetStatsAtom } from "../src/state/changes";
import { conflationFormAtom } from "../src/state/conflation";

const CANDIDATE: OsmConflationCandidateView = {
  id: "node:11:22",
  entityType: "node",
  sourceId: 11,
  targetId: 22,
  status: "review",
  reasons: ["routing-property"],
  propertyTransfer: { status: "review", reasons: ["routing-property"] },
  networkAttachment: { status: "automatic", reasons: [] },
  evidence: {
    distanceMeters: 0.25,
    sourceRoutingFamilies: ["pedestrian"],
    targetRoutingFamilies: ["bicycle-shared"],
    tagDiff: [
      {
        key: "crossing",
        baseValue: "unmarked",
        patchValue: "marked",
        protected: false,
        routing: false,
      },
    ],
    bearingDifferenceDegrees: 4,
    lengthDifferenceRatio: 0.02,
    maxGeometryDistanceMeters: 0.4,
  },
};

function renderWithStore(
  element: React.ReactNode,
  configure: (store: ReturnType<typeof createStore>) => void,
) {
  const store = createStore();
  configure(store);
  return renderToStaticMarkup(createElement(Provider, { store }, element));
}

describe("merge inline guidance", () => {
  it("describes proximity controls and connects the help with aria-describedby", () => {
    const html = renderWithStore(createElement(ConflationConfig), (store) => {
      store.set(conflationFormAtom, {
        enabled: true,
        transferProperties: true,
        propertyKeys: "barrier, crossing, kerb, tactile_paving",
        attachNetwork: true,
        maxDistanceMeters: 1,
      });
    });

    expect(html).toContain("OSM tag keys to transfer");
    expect(html).toContain("Candidate search radius (meters)");
    expect(html).toContain('aria-describedby="conflation-property-transfer-help"');
    expect(html).toContain('aria-describedby="conflation-property-keys-help"');
    expect(html).toContain('aria-describedby="conflation-network-attachment-help"');
    expect(html).toContain('aria-describedby="conflation-distance-help"');
    expect(html).toContain("Distance alone never guarantees acceptance");
    expect(html).toContain("routing-affecting tags require review");
    expect(html).toContain("equivalent one-to-one imported");
    expect(html).toContain("tagless nodes");
    expect(html).toContain("referenced by any way or relation");
  });

  it("humanizes candidate statuses, reasons, evidence, and actions", () => {
    const legend = renderToStaticMarkup(createElement(ConflationStatusLegend));
    const evidence = renderToStaticMarkup(
      createElement(CandidateEvidence, { candidate: CANDIDATE }),
    );
    const actions = renderToStaticMarkup(
      createElement(CandidateActions, { candidate: CANDIDATE, onDecision: async () => {} }),
    );
    const actionStatuses = renderToStaticMarkup(
      createElement(CandidateActionStatuses, { candidate: CANDIDATE }),
    );

    expect(legend).toContain('aria-label="About candidate statuses"');
    expect(legend).not.toContain("at least one action needs a decision");
    expect(conflationReasonLabel("would-collapse-way")).toBe("Attachment would collapse a way");
    expect(conflationCandidateTitle(CANDIDATE)).toBe("Imported node 11 → Base node 22");
    expect(evidence).toContain('aria-label="About candidate evidence metrics"');
    expect(evidence).not.toContain("Distance finds nearby candidates");
    expect(evidence).toContain("Imported routing family");
    expect(evidence).toContain("Base routing family");
    expect(evidence).toContain("Property");
    expect(evidence).toContain("Base value");
    expect(evidence).toContain("Imported value");
    expect(actions).toContain("Transfer + attach");
    expect(actionStatuses).toContain("Property transfer");
    expect(actionStatuses).toContain("Needs review");
    expect(actionStatuses).toContain("Network attachment");
    expect(actionStatuses).toContain("Automatic");

    const wayStatuses = renderToStaticMarkup(
      createElement(CandidateActionStatuses, {
        candidate: { ...CANDIDATE, entityType: "way", networkAttachment: null },
      }),
    );
    expect(wayStatuses).not.toContain("Network attachment");
  });

  it("defines the routing baseline, metrics, signed deltas, and mode invariants", () => {
    const mode = {
      before: { components: 2, edges: 2, nodes: 3, routableNodes: 3 },
      after: { components: 1, edges: 4, nodes: 4, routableNodes: 4 },
      delta: { components: -1, edges: 2, nodes: 1, routableNodes: 1 },
    };
    const diagnostics: OsmConflationRoutingDiagnostics = { car: mode, walk: mode };
    const html = renderToStaticMarkup(createElement(ConflationRoutingDiagnostics, { diagnostics }));

    expect(html).toContain("including exact reconciliation when selected");
    expect(html).toContain("Routable nodes");
    expect(html).toContain("Directed edges");
    expect(html).toContain("Connected components");
    expect(html).toContain("weakly connected groups");
    expect(html).toContain("does not guarantee travel in both directions");
    expect(html).toContain("Signed delta");
    expect(html).toContain(">+2<");
    expect(html).toContain("walk-only attachment should not change CAR topology");
    expect(html).toContain("do not prove that routing is correct");
  });

  it("shows reconciliation and intersection statistics with labeled filter groups", () => {
    const html = renderWithStore(
      createElement("div", null, createElement(ChangesSummary), createElement(ChangesFilters)),
      (store) => {
        store.set(changesetStatsAtom, {
          osmId: "merged",
          totalChanges: 25,
          nodeChanges: 10,
          wayChanges: 9,
          relationChanges: 6,
          deduplicatedNodes: 3,
          deduplicatedNodesReplaced: 7,
          deduplicatedWays: 2,
          intersectionPointsFound: 5,
          intersectionNodesCreated: 4,
        });
      },
    );

    expect(html).toContain("Reconciled nodes");
    expect(html).toContain("Node references rewritten");
    expect(html).toContain("Reconciled ways");
    expect(html).toContain("Intersection nodes created");
    expect(html).toContain("way node references and relation node members changed");
    expect(html).toContain("one surviving entity");
    expect(html).toContain("<legend");
    expect(html).toContain("Change type");
    expect(html).toContain("Entity type");
  });
});
