import { createStore, Provider } from "jotai";
import { buildConflationActionDecision, type OsmConflationCandidateView } from "osmix";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { CandidateActions } from "../src/components/conflation-review";
import { ConflationWayRemovalPreview } from "../src/components/conflation-way-removal";
import { generatedMergeOutcomeAtom, updateMergeOutcomeAtom } from "../src/state/merge-outcome";
import { createWayRemovalSession } from "./fixtures/way-removal";

function candidateFrom(session: ReturnType<typeof createWayRemovalSession>) {
  const candidate = session.worker
    .getConflationPage(session.base.id, 0, 20)
    .candidates.find((candidate) => candidate.id === "way:20->10");
  if (!candidate) throw Error("Expected imported way candidate");
  return candidate;
}

function controls(candidate: OsmConflationCandidateView) {
  return renderToStaticMarkup(
    createElement(
      Provider,
      { store: createStore() },
      createElement(CandidateActions, {
        candidate,
        onDecision: async () => {},
        onReviewConnection: async () => {},
      }),
    ),
  );
}

function removalCheckbox(html: string) {
  return [...html.matchAll(/<label[^>]*>([\s\S]*?)<\/label>/g)]
    .map((match) => match[1])
    .find((label) => label?.includes("Remove imported way"));
}

describe("explicit imported-way removal review", () => {
  it("starts unselected and shows the counterpart, cleanup, and attribute consequence", () => {
    const session = createWayRemovalSession();
    const candidate = candidateFrom(session);
    const html = controls(candidate);
    expect(removalCheckbox(html)).toContain('aria-checked="false"');
    expect(removalCheckbox(html)).not.toContain('aria-disabled="true"');
    expect(html).toContain("Remove imported way 20; retain base way 10.");
    expect(html).toContain("Newly orphaned points to remove: 101, 102");
    expect(html).toContain("Removing this way also removes its remaining attributes");
    expect(html).toContain("Removal is never selected automatically");
    expect(session.base.ways.getById(20)).toBeNull();
    expect(session.patch.ways.getById(20)).not.toBeNull();
  });

  it("blocks a branching trunk and provides a path to review its connection", () => {
    const session = createWayRemovalSession({ branch: true });
    const candidate = candidateFrom(session);
    const html = controls(candidate);
    expect(removalCheckbox(html)).toContain('aria-disabled="true"');
    expect(html).toContain("Select the required branch connections before removal");
    expect(html).toContain("Review connection at imported point 102");
    expect(html).toContain("retained ways 30");
    expect(html).toContain("Removal checks not passed at imported points: 102");
  });

  it("previews explicit branch-preserving removal without applying and invalidates stale evidence", () => {
    const session = createWayRemovalSession({ branch: true });
    session.worker.setConflationSourceDecision(
      session.base.id,
      { entityType: "node", sourceId: 102 },
      {
        candidateId: "node:102->2",
        action: "accept",
        transferProperties: false,
        attachNetwork: true,
      },
    );
    const candidate = candidateFrom(session);
    expect(candidate.wayRemoval?.status).toBe("review");
    const decision = buildConflationActionDecision(
      candidate,
      candidate.decision,
      "remove-way",
      true,
    );
    session.worker.setConflationSourceDecision(session.base.id, candidate, decision);
    const result = session.worker.generateConflationChangeset(session.base.id, {
      directMerge: true,
    });
    const html = renderToStaticMarkup(
      createElement(ConflationWayRemovalPreview, { outcome: result.outcome }),
    );
    expect(html).toContain('aria-label="Way removal preview"');
    expect(html).toContain("Imported ways to remove: 1");
    expect(html).toContain("Explicit network connection selected");
    expect(html).toContain("The dataset changes only when you apply the cumulative merge");
    expect(session.worker.dataset(session.base.id).ways.getById(20)).toBeNull();
    expect(session.worker.dataset(session.patch.id).ways.getById(20)).not.toBeNull();

    const store = createStore();
    store.set(updateMergeOutcomeAtom, { type: "generated", outcome: result.outcome });
    expect(store.get(generatedMergeOutcomeAtom)).toBe(result.outcome);
    store.set(updateMergeOutcomeAtom, { type: "invalidate-preview" });
    expect(store.get(generatedMergeOutcomeAtom)).toBeNull();
  });
});
