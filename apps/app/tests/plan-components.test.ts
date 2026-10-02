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
import { SuggestedChoices } from "../src/components/suggested-choices";

const render = (element: ReactElement) =>
  renderToStaticMarkup(createElement(Provider, { store: createStore() }, element));
const noop = () => {};
const asyncNoop = async () => {};

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
        onApplyAutomatically: asyncNoop,
        onReviewPlan: asyncNoop,
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

  it("shows a choice the automation level made as its rule, which a person can change", () => {
    const html = render(
      createElement(PlanProposalActions, {
        proposal: connect({ decision: "accept", automated: true, effect: "applied" }),
        onDecide: noop,
      }),
    );
    expect(html).toContain("Decided by Recommended");
    expect(html).toContain("Include (Recommended)");
    expect(html).toContain("Leave out");
    expect(html.match(/type="radio"/g)).toHaveLength(2);
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
        preview: {
          accept: { changed: 3, waiting: 2 },
          reject: { changed: 1, waiting: 0 },
          clear: { changed: 0, waiting: 4 },
          "pick-nearest": { changed: 2, waiting: 1 },
        },
      }),
    );
    expect(html).toContain("No imported features match these filters");
    expect(html).toContain("Include 3 features");
    expect(html).toContain("Pick nearest for 2 features");
    expect(html).toContain("Waiting because");
    expect(html).toContain("Leave out 1 feature");
    expect(html).toContain("After Include, 2 still need their own choice");
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
        automated: 0,
        replacesBase: 0,
      },
      diagnostics: {
        routing: { car: delta, walk: delta },
        integrity: ["way -1 references missing node -99"],
        demoted: [],
      },
      decisions: [],
      choices: {
        removal: 0,
        individual: 0,
        replacement: 0,
        bend: 0,
        tie: 0,
        nearest: 0,
        "routing-tags": 0,
        other: 1,
      },
      staleDecisions: [],
      featureCount: 3,
    } as MergePlanOverview;
    const html = render(createElement(PlanSummary, { overview }));
    expect(html).toContain("This plan would break routing and cannot be applied");
    expect(html).toContain("way -1 references missing node -99");
    expect(html).toContain("Needs decision");
    expect(html).not.toContain("Replaced");
  });

  it("groups what still needs a decision, largest first, with a way to show each", () => {
    const html = render(
      createElement(SuggestedChoices, {
        choices: {
          removal: 1,
          individual: 0,
          replacement: 0,
          bend: 4_063,
          tie: 20,
          nearest: 15_359,
          "routing-tags": 8_727,
          other: 0,
        },
        group: "bend",
        onShow: noop,
      }),
    );
    expect(html.indexOf("Choices with a clear nearest (15,359)")).toBeLessThan(
      html.indexOf("Routing tag copies (8,727)"),
    );
    expect(html).not.toContain("Needs a closer look");
    expect(html).toContain('aria-label="Show Connections that bend sharply"');
    expect(html).toContain('aria-pressed="true"');
  });
});
