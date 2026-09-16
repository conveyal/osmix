import {
  Osm,
  type OsmConflationBulkDecisionRequest,
  type OsmConflationCandidateFilter,
  type OsmConflationDecision,
  OsmixWorker,
  summarizeConflationCandidates,
} from "osmix";
import { useEffect } from "react";

import { ConflationReview } from "../src/components/conflation-review";
import { BackToMatching, MatchingReviewProblem } from "../src/components/matching-review-recovery";
import { SectionTitle } from "../src/components/section";
import { Button } from "../src/components/ui/button";
import {
  matchingReviewIssue,
  type MatchingReviewIssue,
  returnToMatchingReview,
} from "../src/lib/matching-review";
import { createHarnessStore, useHarnessSession } from "./harness-store";

type HarnessRequest =
  | {
      kind: "source";
      source: { entityType: "node" | "way"; sourceId: number };
      selected: OsmConflationDecision | null;
    }
  | { kind: "reset"; candidateId: string; decisions: OsmConflationDecision[] }
  | { kind: "bulk"; request: OsmConflationBulkDecisionRequest };

class HarnessWorker extends OsmixWorker {
  add(osm: Osm) {
    this.set(osm.id, osm);
  }

  seedLegacyDecisions(baseId: string, decisions: OsmConflationDecision[]) {
    // Exercise correction of decisions retained before boundary validation existed.
    const session = this["conflations"].get(baseId);
    if (!session) throw Error("Expected an active matching review");
    session.decisions = new Map(decisions.map((decision) => [decision.candidateId, decision]));
    session.summary = summarizeConflationCandidates(session.discovery.candidates, decisions);
  }
}

function createSession(blocked: boolean) {
  const base = new Osm({ id: "review-base" });
  base.nodes.addNode({ id: 1, lon: 0, lat: 0, tags: { name: "Base entrance" } });
  base.nodes.addNode({ id: 2, lon: -0.001, lat: 0 });
  base.nodes.buildIndex();
  base.ways.addWay({ id: 10, refs: [2, 1], tags: { highway: "footway" } });
  base.buildIndexes();
  base.buildSpatialIndexes();
  const patch = new Osm({ id: "review-patch" });
  patch.nodes.addNode({
    id: 101,
    lon: 0.000005,
    lat: 0,
    tags: { name: "Imported entrance", ...(blocked ? { barrier: "gate" } : {}) },
  });
  patch.nodes.addNode({ id: 102, lon: 0.001, lat: 0 });
  patch.nodes.buildIndex();
  patch.ways.addWay({ id: 20, refs: [101, 102], tags: { highway: "footway" } });
  patch.buildIndexes();
  patch.buildSpatialIndexes();
  return startSession(base, patch, blocked, false);
}

function createAlternativeSession(blockedTarget = false) {
  const base = new Osm({ id: "review-base" });
  for (const node of [
    { id: 1, lon: -0.000003, lat: 0, tags: { name: "West entrance" } },
    {
      id: 2,
      lon: 0.000003,
      lat: 0,
      tags: {
        name: blockedTarget ? "Imported entrance" : "East entrance",
        ...(blockedTarget ? { barrier: "gate" } : {}),
      },
    },
    { id: 3, lon: 0.01, lat: 0, tags: { name: "Other entrance" } },
    { id: 4, lon: -0.001, lat: 0 },
    { id: 5, lon: 0.001, lat: 0 },
  ])
    base.nodes.addNode(node);
  base.nodes.buildIndex();
  base.ways.addWay({ id: 10, refs: [4, 1], tags: { highway: "footway" } });
  base.ways.addWay({ id: 11, refs: [2, 5], tags: { highway: "footway" } });
  base.buildIndexes();
  base.buildSpatialIndexes();
  const patch = new Osm({ id: "review-patch" });
  patch.nodes.addNode({ id: 101, lon: 0, lat: 0, tags: { name: "Imported entrance" } });
  patch.nodes.addNode({ id: 102, lon: 0.010005, lat: 0, tags: { name: "Unrelated import" } });
  patch.nodes.addNode({ id: 103, lon: 0.005, lat: 0 });
  patch.nodes.buildIndex();
  patch.ways.addWay({ id: 20, refs: [101, 103], tags: { highway: "footway" } });
  patch.buildIndexes();
  patch.buildSpatialIndexes();
  return startSession(base, patch, blockedTarget, true);
}

function startSession(base: Osm, patch: Osm, blocked: boolean, alternatives: boolean) {
  const worker = new HarnessWorker();
  worker.add(base);
  worker.add(patch);
  worker.discoverConflation(base.id, patch.id, { propertyKeys: ["name"], attachNetwork: true });
  const filter: OsmConflationCandidateFilter = { entityType: "node" };
  worker.setConflationFilter(base.id, filter);
  return {
    base,
    patch,
    worker,
    blocked,
    alternatives,
    filter,
    pageNumber: 0,
    decisions: [] as OsmConflationDecision[],
    requests: [] as HarnessRequest[],
    preview: null as ReturnType<OsmixWorker["getChangesetPage"]> | null,
    generations: 0,
    generationAttempts: 0,
    issue: null as MatchingReviewIssue | null,
    showPreview: false,
    delayNavigation: false,
    finishNavigation: null as (() => void) | null,
  };
}

type Session = ReturnType<typeof createSession>;

function snapshot(session: Session) {
  return structuredClone({
    blocked: session.blocked,
    decisions: session.decisions,
    requests: session.requests,
    workerPage: session.worker.getConflationPage(session.base.id, session.pageNumber, 1, {
      groupBySource: session.alternatives,
    }),
    filter: session.filter,
    inputs: { base: [...session.base.nodes.sorted()], patch: [...session.patch.nodes.sorted()] },
    options: { propertyKeys: ["name"], attachNetwork: true },
    issue: session.issue,
    preview: session.preview,
    generations: session.generations,
    generationAttempts: session.generationAttempts,
  });
}

const store = createHarnessStore<Session>(() => createSession(false));

export function ConflationReviewHarness() {
  const session = useHarnessSession(store);

  useEffect(() => {
    window.conflationReviewHarness = { readState: () => snapshot(session) };
  }, [session]);

  const generate = () =>
    store.mutate((current) => {
      current.generationAttempts++;
      try {
        current.worker.generateConflationChangeset(current.base.id, { directMerge: true });
        current.preview = current.worker.getChangesetPage(current.base.id, 0, 100);
        current.generations++;
        current.issue = null;
      } catch (error) {
        current.issue = matchingReviewIssue(error);
      }
      current.showPreview = true;
    });
  const updateFilter = async (filter: OsmConflationCandidateFilter) =>
    store.mutate((current) => {
      current.filter = filter;
      current.worker.setConflationFilter(current.base.id, filter);
      current.pageNumber = 0;
    });
  const updatePage = async (page: number) =>
    store.mutate((current) => {
      current.pageNumber = page;
    });
  const returnToMatching = () =>
    returnToMatchingReview({
      filter: session.filter,
      page: session.pageNumber,
      issue: session.issue,
      onFilterChange: updateFilter,
      onPageChange: updatePage,
      onReturn: () =>
        store.mutate((current) => {
          current.showPreview = false;
        }),
    });
  const saveSource = async (
    source: { entityType: "node" | "way"; sourceId: number },
    selected: OsmConflationDecision | null,
  ) => {
    store.mutate((current) => {
      current.requests.push({ kind: "source", source, selected: structuredClone(selected) });
      const result = current.worker.setConflationSourceDecision(current.base.id, source, selected);
      current.decisions = result.decisions;
      current.preview = null;
      current.issue = null;
    });
  };
  const nodeChange = session.preview?.changes?.find(
    (change) => change.entity.id === 1 && "lon" in change.entity,
  );
  const wayChange = session.preview?.changes?.find(
    (change) => change.entity.id === 20 && "refs" in change.entity,
  );

  return (
    <section className="mt-2 flex min-w-0 flex-col gap-2" data-testid="conflation-review-harness">
      <SectionTitle>Matching interaction fixture</SectionTitle>
      <div className="flex flex-wrap gap-1">
        <Button variant="outline" onClick={() => store.replace(createSession(false))}>
          Load compatible fixture
        </Button>
        <Button variant="outline" onClick={() => store.replace(createSession(true))}>
          Load blocked connection fixture
        </Button>
        <Button variant="outline" onClick={() => store.replace(createAlternativeSession())}>
          Load alternative target fixture
        </Button>
        <Button variant="outline" onClick={() => store.replace(createAlternativeSession(true))}>
          Load blocked target fixture
        </Button>
        <Button
          variant="outline"
          onClick={() => {
            const next = createAlternativeSession();
            next.decisions = [
              { candidateId: "node:101->1", action: "accept" },
              { candidateId: "node:101->2", action: "accept" },
              { candidateId: "node:102->3", action: "reject" },
            ];
            next.worker.seedLegacyDecisions(next.base.id, next.decisions);
            store.replace(next);
          }}
        >
          Load conflicting saved review
        </Button>
        <Button
          variant="outline"
          onClick={() =>
            store.mutate((current) => {
              current.delayNavigation = true;
            })
          }
        >
          Delay next candidate navigation
        </Button>
        <Button onClick={() => store.current.finishNavigation?.()}>
          Complete delayed page change
        </Button>
      </div>
      {session.showPreview ? (
        <div className="flex flex-col gap-2 border p-2" data-testid="matching-preview">
          <SectionTitle>Generated matching preview</SectionTitle>
          <MatchingReviewProblem issue={session.issue} />
          {session.preview ? (
            <>
              <dl className="grid grid-cols-1 gap-1">
                <dt>Base entrance name</dt>
                <dd data-testid="preview-name">
                  {String(
                    nodeChange?.entity.tags?.["name"] ??
                      session.base.nodes.getById(1)?.tags?.["name"],
                  )}
                </dd>
                <dt>Imported way node references</dt>
                <dd data-testid="preview-refs">
                  {wayChange && "refs" in wayChange.entity
                    ? wayChange.entity.refs.join(", ")
                    : "None"}
                </dd>
              </dl>
            </>
          ) : null}
          <Button onClick={generate}>Regenerate current preview</Button>
          <BackToMatching onBack={returnToMatching} />
        </div>
      ) : (
        <>
          <div data-testid="conflation-review-panel">
            <MatchingReviewProblem issue={session.issue} />
            <ConflationReview
              base={session.base}
              patch={session.patch}
              summary={session.worker.getConflationSummary(session.base.id)}
              page={session.worker.getConflationPage(session.base.id, session.pageNumber, 1, {
                groupBySource: session.alternatives,
              })}
              filter={session.filter}
              isFilterPending={false}
              onDecision={async (decision) => {
                const candidate = session.worker
                  .getConflationPage(session.base.id, session.pageNumber, 1, {
                    groupBySource: session.alternatives,
                  })
                  .candidates.find((row) => row.id === decision.candidateId);
                if (!candidate) throw Error("Expected the selected candidate on the current page");
                await saveSource(
                  { entityType: candidate.entityType, sourceId: candidate.sourceId },
                  decision,
                );
              }}
              onLeaveUnmatched={(source) => saveSource(source, null)}
              onResetDecision={async (candidateId) => {
                store.mutate((current) => {
                  const decisions = current.decisions.filter(
                    (row) => row.candidateId !== candidateId,
                  );
                  current.requests.push({
                    kind: "reset",
                    candidateId,
                    decisions: structuredClone(decisions),
                  });
                  current.worker.setConflationDecisions(current.base.id, decisions);
                  current.decisions = decisions;
                  current.preview = null;
                  current.issue = null;
                });
              }}
              onBulkDecision={async (request) => {
                store.mutate((current) => {
                  current.requests.push({ kind: "bulk", request: structuredClone(request) });
                  const result = current.worker.applyConflationBulkDecision(
                    current.base.id,
                    request,
                  );
                  current.decisions = result.decisions;
                  current.preview = null;
                });
              }}
              onFilterChange={updateFilter}
              onPageChange={async (page) => {
                if (store.current.delayNavigation) {
                  store.mutate((current) => {
                    current.delayNavigation = false;
                  });
                  await new Promise<void>((resolve) => {
                    store.mutate((current) => {
                      current.finishNavigation = resolve;
                    });
                  });
                  store.mutate((current) => {
                    current.finishNavigation = null;
                  });
                }
                await updatePage(page);
              }}
            />
          </div>
          <Button onClick={generate}>Preview current choices</Button>
        </>
      )}
    </section>
  );
}

declare global {
  interface Window {
    conflationReviewHarness: { readState: () => ReturnType<typeof snapshot> };
  }
}
