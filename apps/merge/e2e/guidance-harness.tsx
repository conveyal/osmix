import { useState } from "react";
import { createRoot } from "react-dom/client";

import "../src/main.css";
import { MergeStepGuide } from "../src/components/merge-step-guide";

interface HarnessState {
  decision: string;
  propertyKeys: string;
  workerCalls: number;
  workflowStep: string;
}

const harnessState: HarnessState = {
  decision: "pending",
  propertyKeys: "name surface kerb",
  workerCalls: 0,
  workflowStep: "direct",
};

function GuidanceHarness() {
  const [propertyKeys, setPropertyKeys] = useState(harnessState.propertyKeys);
  const [workerCalls, setWorkerCalls] = useState(harnessState.workerCalls);

  return (
    <main className="w-full max-w-[512px] p-2" data-testid="guidance-sidebar">
      <section className="min-w-0 overflow-hidden border bg-card p-2">
        <MergeStepGuide guideId="direct" />

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
  readState: () => ({ ...harnessState }),
};

createRoot(document.getElementById("root")!).render(<GuidanceHarness />);

declare global {
  interface Window {
    guidanceHarness: {
      readState: () => HarnessState;
    };
  }
}
