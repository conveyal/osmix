import { createStore, Provider } from "jotai";
import type {
  MergePlanFeatureView,
  MergePlanOverview,
  MergePlanPage,
  PlanOutcome,
  PlanProposal,
} from "osmix";
import { createElement, type ReactElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { PatchIdNotice } from "../src/components/patch-id-notice";
import { PlanFeatureRow } from "../src/components/plan-feature-row";
import {
  MERGE_IDENTICAL_LABEL,
  PlanInputs,
  TREAT_AS_NEW_LABEL,
} from "../src/components/plan-inputs";
import { PlanProposalActions } from "../src/components/plan-proposal-actions";
import { PlanReview } from "../src/components/plan-review";
import { PlanSummary } from "../src/components/plan-summary";

const render = (element: ReactElement) =>
  renderToStaticMarkup(createElement(Provider, { store: createStore() }, element));
const noop = () => {};

const connect = (overrides: Partial<PlanProposal> = {}) =>
  ({
    id: "connect:n-2>n2",
    kind: "connect",
    feature: "way:-1",
    source: { type: "node", id: -2 },
    target: { type: "node", id: 2 },
    candidateId: "node:-2->2",
    alternatives: [],
    status: "review",
    reasons: [],
    effect: "needs-decision",
    ...overrides,
  }) as PlanProposal;

function feature(outcome: PlanOutcome, proposals: PlanProposal[]): MergePlanFeatureView {
  return {
    key: "way:-1",
    type: "way",
    originalId: -1,
    id: -1,
    vertexIds: [-1, -2],
    outcome,
    proposalIds: proposals.map(({ id }) => id),
    bbox: [0, 0, 0.001, 0],
    name: "Harbour Walk",
    proposals,
  };
}

const outcomes = (counts: Partial<Record<PlanOutcome, number>>) => ({
  "needs-decision": 0,
  removed: 0,
  merged: 0,
  connected: 0,
  replaced: 0,
  added: 0,
  unchanged: 0,
  ...counts,
});

describe("plan components", () => {
  it("offers both entry points, automatic first and the review last", () => {
    const html = render(
      createElement(PlanInputs, {
        disabled: false,
        onApplyAutomatically: noop,
        onReviewPlan: noop,
      }),
    );
    expect(html).toContain(MERGE_IDENTICAL_LABEL);
    expect(html).toContain(TREAT_AS_NEW_LABEL);
    expect(html.indexOf("Apply automatically")).toBeLessThan(html.indexOf("Review plan"));
  });

  it("says how many base entities the patch replaces, and hides when none", () => {
    expect(
      render(createElement(PatchIdNotice, { mode: "osm", onChange: noop, replacesBase: 0 })),
    ).toBe("");
    const html = render(
      createElement(PatchIdNotice, { mode: "osm", onChange: noop, replacesBase: 3 }),
    );
    expect(html).toContain("3 patch entities replace base entities");
    expect(html).toContain("Treat all as new");
  });

  it("offers the choices each proposal status allows", () => {
    const review = render(
      createElement(PlanProposalActions, { proposal: connect(), onDecide: noop }),
    );
    expect(review.match(/type="radio"/g)).toHaveLength(3);
    expect(review).toContain("Connect network with base node 2");
    const automatic = render(
      createElement(PlanProposalActions, {
        proposal: connect({ status: "automatic", effect: "applied" }),
        onDecide: noop,
      }),
    );
    expect(automatic.match(/type="radio"/g)).toHaveLength(2);
    const blocked = render(
      createElement(PlanProposalActions, {
        proposal: connect({
          status: "blocked",
          effect: "blocked",
          reasons: ["routing-family-conflict"],
        }),
        onDecide: noop,
      }),
    );
    expect(blocked).not.toContain('type="radio"');
    expect(blocked).toContain("Allowed travel is incompatible");
  });

  it("names a feature row by its imported ID and shows its outcome", () => {
    const html = render(
      createElement(PlanFeatureRow, {
        detail: null,
        feature: feature("needs-decision", [connect()]),
        onDecide: noop,
        onSelect: noop,
      }),
    );
    expect(html).toContain('aria-label="Imported way -1"');
    expect(html).toContain("Harbour Walk");
    expect(html).toContain("Needs decision");
  });

  it("lists features with filters and says when none match", () => {
    const page: MergePlanPage = { features: [], total: 0, totalPages: 0 };
    const html = render(
      createElement(PlanReview, {
        detail: null,
        filter: { outcome: "removed" },
        onBulk: noop,
        onDecide: noop,
        onFilterChange: noop,
        onPageChange: noop,
        onSelect: noop,
        page,
        pageIndex: 0,
      }),
    );
    expect(html).toContain("No imported features match these filters");
    expect(html).toContain("All proposals");
  });

  it("summarizes outcomes and refuses a plan that breaks routing", () => {
    const routing = { before: { nodes: 1, routableNodes: 1, edges: 1, components: 1 } };
    const delta = { ...routing, after: routing.before, delta: { ...routing.before } };
    const overview = {
      inputs: { base: { id: "b", contentHash: "1" }, patch: { id: "p", contentHash: "2" } },
      options: {},
      idRemap: { mode: "osm", remapped: 0 },
      summary: {
        features: outcomes({ added: 2, "needs-decision": 1 }),
        proposals: { automatic: 2, review: 1, blocked: 0 },
        replacesBase: 0,
      },
      diagnostics: {
        routing: { car: delta, walk: delta },
        integrity: ["way -1 references missing node -99"],
        demoted: [],
      },
      decisions: [],
      staleDecisions: [],
      featureCount: 3,
    } as MergePlanOverview;
    const html = render(createElement(PlanSummary, { overview }));
    expect(html).toContain("This plan would break routing and cannot be applied");
    expect(html).toContain("way -1 references missing node -99");
    expect(html).toContain("Needs decision");
    expect(html).not.toContain("Replaced");
  });
});
