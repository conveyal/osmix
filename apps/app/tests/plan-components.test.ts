import { createStore, Provider } from "jotai";
import type {
  MergePlanFeatureView,
  MergePlanOverview,
  MergePlanPage,
  OsmConflationCandidate,
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
import { planDraftAtom, planOverviewAtom } from "../src/state/merge-plan";

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

  it("refuses to plan an import too large for the browser, and says why", () => {
    const html = render(
      createElement(PlanInputs, {
        disabled: false,
        onApplyAutomatically: asyncNoop,
        onReviewPlan: asyncNoop,
        tooLarge: "Planning needs about 4.4 GB of memory.",
      }),
    );
    expect(html).toContain("This import is too large to plan in the browser");
    expect(html).toContain("Planning needs about 4.4 GB of memory.");
    expect(html).toMatch(/<button[^>]*disabled[^>]*>(?:(?!<\/button>).)*Apply automatically/);
    expect(html).toMatch(/<button[^>]*disabled[^>]*>(?:(?!<\/button>).)*Review plan/);
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
    expect(review).toContain("Connect imported point -2 to base node 2");
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

  it("names the base ways a replacement deletes and the imported ways decided with it", () => {
    const replace = {
      id: "replace:w20>w10,w11",
      kind: "replace-way",
      feature: "way:20",
      source: { type: "way", id: 20 },
      replaces: [
        { type: "way", id: 10 },
        { type: "way", id: 11 },
      ],
      set: ["replace:w30>w10,w11"],
      together: [{ type: "way", id: 30 }],
      status: "review",
      reasons: [],
      effect: "needs-decision",
    } as PlanProposal;
    const html = render(createElement(PlanProposalActions, { proposal: replace, onDecide: noop }));
    expect(html).toContain("Replace base ways 10, 11");
    expect(html).toContain("Decided together with imported way 30.");
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

  it("shows a pair's evidence once, named by the points it compares", () => {
    const copy = connect({ id: "copy:n-2>n2", kind: "copy-tags" } as Partial<PlanProposal>);
    const candidate = {
      id: "node:-2->2",
      entityType: "node",
      sourceId: -2,
      targetId: 2,
      status: "review",
      reasons: [],
      propertyTransfer: { status: "review", reasons: [] },
      networkAttachment: { status: "review", reasons: [] },
      evidence: {
        distanceMeters: 0.4,
        sourceRoutingFamilies: [],
        targetRoutingFamilies: [],
        tagDiff: [],
      },
    } as unknown as OsmConflationCandidate;
    const view = feature("needs-decision", [connect(), copy]);
    const html = render(
      createElement(PlanFeatureRow, {
        detail: {
          ...view,
          candidates: { "connect:n-2>n2": candidate, "copy:n-2>n2": candidate },
          coordinates: [],
          targets: {},
          replaces: {},
        },
        feature: view,
        onDecide: noop,
        onSelect: noop,
      }),
    );
    expect(html).toContain("Copy tags from imported point -2 to base node 2");
    expect(html.match(/aria-label="Evidence: /g)).toHaveLength(1);
    expect(html).toContain("Evidence: imported point -2 and base node 2");
  });

  it("shows row choices waiting to be applied, and holds bulk choices until then", () => {
    const page: MergePlanPage = { features: [], total: 0, totalPages: 0 };
    const html = render(
      createElement(PlanReview, {
        detail: null,
        filter: {},
        onBulk: noop,
        onDecide: noop,
        onFilterChange: noop,
        onPageChange: noop,
        onSelect: noop,
        page,
        pageIndex: 0,
        pending: { count: 3, onApply: noop, onDiscard: noop },
        error: "These choices cannot apply together, so the plan is unchanged.",
        preview: {
          accept: { changed: 3, waiting: 0 },
          reject: { changed: 1, waiting: 0 },
          clear: { changed: 0, waiting: 0 },
          "pick-nearest": { changed: 0, waiting: 0 },
        },
      }),
    );
    // A failed apply keeps the choices and says why, next to them.
    expect(html).toContain("The plan was not updated");
    expect(html).toContain("These choices cannot apply together");
    expect(html).toContain("3 choices not applied yet");
    expect(html).toContain("Apply 3 choices");
    expect(html).toContain("Discard");
    expect(html).toMatch(/<button[^>]*disabled[^>]*>(?:(?!<\/button>).)*Include 3 features/);
  });

  it("marks a row's choice that is not applied yet", () => {
    const store = createStore();
    store.set(planOverviewAtom, { decisions: [], options: {} } as unknown as MergePlanOverview);
    store.set(planDraftAtom, {
      decisions: [{ proposalId: "connect:n-2>n2", action: "accept" }],
      chosen: ["connect:n-2>n2"],
    });
    const html = renderToStaticMarkup(
      createElement(
        Provider,
        { store },
        createElement(PlanProposalActions, { proposal: connect(), onDecide: noop }),
      ),
    );
    expect(html).toContain("Choice not applied yet");
    expect(html).toMatch(/value="accept"[^>]*checked|checked[^>]*value="accept"/);
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
