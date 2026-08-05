import { useState } from "react";
import { createRoot } from "react-dom/client";

import "../src/main.css";
import {
  AutomaticMergeProgress,
  CONFLATION_AUTOMATIC_MERGE_STEPS,
} from "../src/components/automatic-merge-progress";
import { InfoTooltip } from "../src/components/info-tooltip";
import { MergeStepGuide } from "../src/components/merge-step-guide";
import { OsmInputCardHeader } from "../src/components/osm-input-card-header";
import { StepActions } from "../src/components/step-actions";
import { Button } from "../src/components/ui/button";
import { Card, CardContent } from "../src/components/ui/card";

interface InputHarnessState {
  baseDownloads: number;
  baseLoaded: boolean;
  patchDownloads: number;
  patchLoaded: boolean;
}

interface HarnessState {
  decision: string;
  inputs: InputHarnessState;
  propertyKeys: string;
  workerCalls: number;
  workflowStep: string;
}

const harnessState: HarnessState = {
  decision: "pending",
  inputs: {
    baseDownloads: 0,
    baseLoaded: true,
    patchDownloads: 0,
    patchLoaded: true,
  },
  propertyKeys: "name surface kerb",
  workerCalls: 0,
  workflowStep: "direct",
};

function GuidanceHarness() {
  const [propertyKeys, setPropertyKeys] = useState(harnessState.propertyKeys);
  const [workerCalls, setWorkerCalls] = useState(harnessState.workerCalls);
  const [automaticStepIndex, setAutomaticStepIndex] = useState(0);
  const [inputs, setInputs] = useState(harnessState.inputs);
  const updateInputs = (update: (current: InputHarnessState) => InputHarnessState) => {
    setInputs((current) => {
      const next = update(current);
      harnessState.inputs = next;
      return next;
    });
  };

  return (
    <main className="w-full max-w-[512px] p-2" data-testid="guidance-sidebar">
      <section className="mb-2 flex min-w-0 flex-col gap-2" data-testid="input-card-harness">
        <Card>
          <OsmInputCardHeader
            fileName={
              inputs.baseLoaded
                ? "an-extremely-long-base-osm-filename-that-must-not-push-actions-outside-the-card.pbf"
                : undefined
            }
            kind="base"
            loaded={inputs.baseLoaded}
            onClear={async () => {
              updateInputs((current) => ({ ...current, baseLoaded: false }));
            }}
            onDownload={async () => {
              updateInputs((current) => ({
                ...current,
                baseDownloads: current.baseDownloads + 1,
              }));
            }}
            title="Base OSM — authoritative existing dataset"
          />
          {inputs.baseLoaded ? null : (
            <CardContent>
              <Button>Open base OSM</Button>
            </CardContent>
          )}
        </Card>

        <Card>
          <OsmInputCardHeader
            fileName={inputs.patchLoaded ? "monaco.test.pbf" : undefined}
            kind="patch"
            loaded={inputs.patchLoaded}
            onClear={async () => {
              updateInputs((current) => ({ ...current, patchLoaded: false }));
            }}
            onDownload={async () => {
              updateInputs((current) => ({
                ...current,
                patchDownloads: current.patchDownloads + 1,
              }));
            }}
            title="Patch OSM — imported additions and updates"
          />
          {inputs.patchLoaded ? null : (
            <CardContent>
              <Button>Open patch OSM</Button>
            </CardContent>
          )}
        </Card>
      </section>

      <section className="min-w-0 overflow-hidden border bg-card p-2">
        <MergeStepGuide guideId="direct" />
        <div className="mt-2 flex items-center gap-1">
          Candidate statuses
          <InfoTooltip label="About candidate statuses" side="bottom" align="start">
            Automatic matches apply unless rejected. Review matches need a decision.
          </InfoTooltip>
        </div>

        <div className="mt-2">
          <AutomaticMergeProgress
            currentStepId={CONFLATION_AUTOMATIC_MERGE_STEPS[automaticStepIndex].id}
            elapsedMs={582_000}
            latestMessage={`Worker message for ${CONFLATION_AUTOMATIC_MERGE_STEPS[automaticStepIndex].label}`}
            steps={CONFLATION_AUTOMATIC_MERGE_STEPS}
          />
          <button
            className="mt-2 border p-1"
            type="button"
            onClick={() => {
              setAutomaticStepIndex((current) =>
                Math.min(current + 1, CONFLATION_AUTOMATIC_MERGE_STEPS.length - 1),
              );
            }}
          >
            Advance automatic merge
          </button>
        </div>

        <label className="mt-2 flex min-w-0 flex-col gap-1" htmlFor="property-keys">
          OSM tag keys to transfer
          <input
            id="property-keys"
            className="min-w-0 border bg-background p-1"
            value={propertyKeys}
            onChange={(event) => {
              harnessState.propertyKeys = event.currentTarget.value;
              setPropertyKeys(event.currentTarget.value);
            }}
          />
        </label>

        <dl className="mt-2 grid grid-cols-2 gap-1" data-testid="workflow-state">
          <dt>Workflow step</dt>
          <dd>{harnessState.workflowStep}</dd>
          <dt>Decision</dt>
          <dd>{harnessState.decision}</dd>
        </dl>

        <div className="mt-2 flex flex-col gap-2">
          <StepActions aria-label="Reconciliation step actions">
            <Button variant="outline">Preview without exact reconciliation</Button>
            <Button>Preview with exact reconciliation</Button>
          </StepActions>
          <StepActions aria-label="Imported-data matching step actions">
            <Button variant="outline">Back</Button>
            <Button>Continue with current decisions</Button>
          </StepActions>
          <StepActions aria-label="Intersection step actions">
            <Button variant="outline">Skip intersections and finish</Button>
            <Button>Preview intersection changes</Button>
          </StepActions>
        </div>

        <button
          className="mt-2 border p-1"
          type="button"
          onClick={() => {
            harnessState.workerCalls++;
            setWorkerCalls(harnessState.workerCalls);
          }}
        >
          Simulate worker action ({workerCalls})
        </button>
      </section>
    </main>
  );
}

window.guidanceHarness = {
  readState: () => ({ ...harnessState, inputs: { ...harnessState.inputs } }),
};

createRoot(document.getElementById("root")!).render(<GuidanceHarness />);

declare global {
  interface Window {
    guidanceHarness: {
      readState: () => HarnessState;
    };
  }
}
