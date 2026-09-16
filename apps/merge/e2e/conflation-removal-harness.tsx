import type {
  OsmConflationCandidateFilter,
  OsmConflationDecision,
  OsmConflationOutcomeReport,
} from "osmix";
import { useEffect, useState } from "react";

import { ConflationReview } from "../src/components/conflation-review";
import { ConflationWayRemovalPreview } from "../src/components/conflation-way-removal";
import { Button } from "../src/components/ui/button";
import { createWayRemovalSession } from "../tests/fixtures/way-removal";
import { createHarnessStore, useHarnessSession } from "./harness-store";

type Session = ReturnType<typeof createWayRemovalSession> & {
  decisions: OsmConflationDecision[];
  filter: OsmConflationCandidateFilter;
  delayNextChoice: boolean;
  finishChoice: (() => void) | null;
  decisionCalls: number;
};

function startSession(branch = false, taggedNode = false): Session {
  return {
    ...createWayRemovalSession({ branch, taggedNode }),
    decisions: [],
    filter: { entityType: "way", sourceId: 20 },
    delayNextChoice: false,
    finishChoice: null,
    decisionCalls: 0,
  };
}

const store = createHarnessStore(() => startSession());

export function ConflationRemovalHarness() {
  const session = useHarnessSession(store);
  const [outcome, setOutcome] = useState<OsmConflationOutcomeReport | null>(null);
  const [applied, setApplied] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const page = applied
    ? null
    : session.worker.getConflationPage(session.base.id, 0, 20, { groupBySource: true });

  const choose = async (
    source: { entityType: "node" | "way"; sourceId: number },
    decision: OsmConflationDecision | null,
  ) => {
    store.mutate((current) => {
      current.decisionCalls++;
    });
    if (store.current.delayNextChoice) {
      store.mutate((current) => {
        current.delayNextChoice = false;
      });
      await new Promise<void>((resolve) => {
        store.mutate((current) => {
          current.finishChoice = resolve;
        });
      });
      store.mutate((current) => {
        current.finishChoice = null;
      });
    }
    const current = store.current;
    const result = current.worker.setConflationSourceDecision(current.base.id, source, decision);
    store.mutate((current) => {
      current.decisions = result.decisions;
    });
    setOutcome(null);
    setError(null);
  };

  useEffect(() => {
    window.removalHarness = {
      readState: () => ({
        decisions: structuredClone(session.decisions),
        baseWayIds: [...session.worker.dataset(session.base.id).ways.sorted()].map((way) => way.id),
        baseNodeIds: [...session.worker.dataset(session.base.id).nodes.sorted()].map(
          (node) => node.id,
        ),
        branchRefs: session.worker.dataset(session.base.id).ways.getById(30)?.refs ?? null,
        patchWayPresent: session.worker.dataset(session.patch.id).ways.getById(20) !== null,
        generatedRemovals: outcome?.summary.wayRemovalActions ?? 0,
        applied,
        decisionCalls: session.decisionCalls,
      }),
      finishChoice: () => store.current.finishChoice?.(),
    };
  }, [session, outcome, applied]);

  const run = (action: () => void) => {
    try {
      action();
      setError(null);
    } catch (error) {
      setError(error instanceof Error ? error.message : String(error));
    }
  };

  return (
    <main
      className="flex w-full max-w-[512px] min-w-0 flex-col gap-2 p-2"
      data-testid="removal-harness"
    >
      <div className="flex flex-wrap gap-2">
        {[
          { label: "Standalone removal", branch: false, tagged: false },
          { label: "Branching removal", branch: true, tagged: false },
          { label: "Tagged point removal", branch: false, tagged: true },
        ].map((scenario) => (
          <Button
            key={scenario.label}
            onClick={() => {
              store.replace(startSession(scenario.branch, scenario.tagged));
              setOutcome(null);
              setApplied(false);
              setError(null);
            }}
          >
            {scenario.label}
          </Button>
        ))}
      </div>
      {error ? <p role="alert">{error}</p> : null}
      {page ? (
        <>
          <Button
            onClick={() =>
              store.mutate((current) => {
                current.delayNextChoice = true;
              })
            }
          >
            Delay next choice
          </Button>
          <ConflationReview
            base={session.base}
            patch={session.patch}
            summary={session.worker.getConflationSummary(session.base.id)}
            page={page}
            filter={session.filter}
            isFilterPending={false}
            allowWayRemoval
            onDecision={async (decision) => {
              const candidate = page.candidates.find(
                (candidate) => candidate.id === decision.candidateId,
              );
              if (!candidate) throw Error("Candidate is no longer visible");
              await choose(candidate, decision);
            }}
            onLeaveUnmatched={(source) => choose(source, null)}
            onResetDecision={async (candidateId) => {
              store.mutate((current) => {
                current.decisions = current.decisions.filter(
                  (decision) => decision.candidateId !== candidateId,
                );
                current.worker.setConflationDecisions(current.base.id, current.decisions);
              });
              setOutcome(null);
            }}
            onBulkDecision={async (request) => {
              store.mutate((current) => {
                current.decisions = current.worker.applyConflationBulkDecision(
                  current.base.id,
                  request,
                ).decisions;
              });
              setOutcome(null);
            }}
            onFilterChange={async (filter) => {
              store.mutate((current) => {
                current.worker.setConflationFilter(current.base.id, filter);
                current.filter = filter;
              });
            }}
            onPageChange={async () => {}}
          />
          <Button
            onClick={() =>
              run(() =>
                setOutcome(
                  session.worker.generateConflationChangeset(session.base.id, { directMerge: true })
                    .outcome,
                ),
              )
            }
          >
            Generate removal preview
          </Button>
        </>
      ) : null}
      {outcome ? (
        <>
          <ConflationWayRemovalPreview outcome={outcome} applied={applied} />
          {!applied ? (
            <Button
              onClick={() =>
                run(() => {
                  session.worker.applyChangesAndReplace(session.base.id);
                  setApplied(true);
                })
              }
            >
              Apply previewed merge
            </Button>
          ) : null}
        </>
      ) : null}
    </main>
  );
}

declare global {
  interface Window {
    removalHarness: {
      readState: () => {
        decisions: OsmConflationDecision[];
        baseWayIds: number[];
        baseNodeIds: number[];
        branchRefs: number[] | null;
        patchWayPresent: boolean;
        generatedRemovals: number;
        applied: boolean;
        decisionCalls: number;
      };
      finishChoice: () => void;
    };
  }
}
