import {
  Osm,
  type OsmConflationBulkDecisionRequest,
  type OsmConflationCandidateFilter,
  type OsmConflationDecision,
  OsmixWorker,
} from "osmix";
import { useEffect, useState } from "react";

import { ConflationReview } from "../src/components/conflation-review";
import { SectionTitle } from "../src/components/section";
import { Button } from "../src/components/ui/button";

type HarnessRequest =
  | { kind: "decision"; decision: OsmConflationDecision }
  | { kind: "reset"; candidateId: string; decisions: OsmConflationDecision[] }
  | { kind: "bulk"; request: OsmConflationBulkDecisionRequest };

class HarnessWorker extends OsmixWorker {
  add(osm: Osm) {
    this.set(osm.id, osm);
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
    filter,
    pageNumber: 0,
    decisions: [] as OsmConflationDecision[],
    requests: [] as HarnessRequest[],
    preview: null as ReturnType<OsmixWorker["getChangesetPage"]> | null,
    generations: 0,
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
    workerPage: session.worker.getConflationPage(session.base.id, session.pageNumber, 1),
    preview: session.preview,
    generations: session.generations,
  });
}

export function ConflationReviewHarness() {
  const [session, setSession] = useState(() => createSession(false));
  const [, setRevision] = useState(0);
  const refresh = () => setRevision((revision) => revision + 1);

  useEffect(() => {
    window.conflationReviewHarness = { readState: () => snapshot(session) };
  }, [session]);

  const generate = () => {
    session.worker.generateConflationChangeset(session.base.id, { directMerge: true });
    session.preview = session.worker.getChangesetPage(session.base.id, 0, 100);
    session.generations++;
    session.showPreview = true;
    refresh();
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
        <Button variant="outline" onClick={() => setSession(createSession(false))}>
          Load compatible fixture
        </Button>
        <Button variant="outline" onClick={() => setSession(createSession(true))}>
          Load blocked connection fixture
        </Button>
        <Button
          variant="outline"
          onClick={() => {
            session.delayNavigation = true;
            refresh();
          }}
        >
          Delay next candidate navigation
        </Button>
        <Button onClick={() => session.finishNavigation?.()}>Complete delayed page change</Button>
      </div>
      {session.showPreview ? (
        <div className="flex flex-col gap-2 border p-2" data-testid="matching-preview">
          <SectionTitle>Generated matching preview</SectionTitle>
          <dl className="grid grid-cols-1 gap-1">
            <dt>Base entrance name</dt>
            <dd data-testid="preview-name">
              {String(nodeChange?.entity.tags?.["name"] ?? "Base entrance")}
            </dd>
            <dt>Imported way node references</dt>
            <dd data-testid="preview-refs">
              {wayChange && "refs" in wayChange.entity ? wayChange.entity.refs.join(", ") : "None"}
            </dd>
          </dl>
          <Button onClick={generate}>Regenerate current preview</Button>
          <Button
            variant="outline"
            onClick={() => {
              session.showPreview = false;
              refresh();
            }}
          >
            Back to match review
          </Button>
        </div>
      ) : (
        <>
          <div data-testid="conflation-review-panel">
            <ConflationReview
              base={session.base}
              patch={session.patch}
              summary={session.worker.getConflationSummary(session.base.id)}
              page={session.worker.getConflationPage(session.base.id, session.pageNumber, 1)}
              filter={session.filter}
              isFilterPending={false}
              onDecision={async (decision) => {
                session.requests.push({ kind: "decision", decision: structuredClone(decision) });
                session.worker.setConflationDecision(session.base.id, decision);
                session.decisions = [
                  ...session.decisions.filter((row) => row.candidateId !== decision.candidateId),
                  decision,
                ];
                session.preview = null;
                refresh();
              }}
              onResetDecision={async (candidateId) => {
                const decisions = session.decisions.filter(
                  (row) => row.candidateId !== candidateId,
                );
                session.requests.push({
                  kind: "reset",
                  candidateId,
                  decisions: structuredClone(decisions),
                });
                session.worker.setConflationDecisions(session.base.id, decisions);
                session.decisions = decisions;
                session.preview = null;
                refresh();
              }}
              onBulkDecision={async (request) => {
                session.requests.push({ kind: "bulk", request: structuredClone(request) });
                const result = session.worker.applyConflationBulkDecision(session.base.id, request);
                session.decisions = result.decisions;
                session.preview = null;
                refresh();
              }}
              onFilterChange={async (filter) => {
                session.filter = filter;
                session.worker.setConflationFilter(session.base.id, filter);
                session.pageNumber = 0;
                refresh();
              }}
              onPageChange={async (page) => {
                if (session.delayNavigation) {
                  session.delayNavigation = false;
                  await new Promise<void>((resolve) => {
                    session.finishNavigation = resolve;
                    refresh();
                  });
                  session.finishNavigation = null;
                }
                session.pageNumber = page;
                refresh();
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
