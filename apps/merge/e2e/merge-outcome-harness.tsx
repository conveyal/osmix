import { ActionButton, Button } from "@osmix/ui";
import { useAtomValue, useSetAtom } from "jotai";
import { Osm, OsmixWorker, type OsmConflationOptions, type OsmNode } from "osmix";
import { useEffect, useState } from "react";

import { MergeCompletionSummary } from "../src/components/merge-completion-summary";
import { writeJsonReport } from "../src/lib/json-download";
import { mergeCompletionAtom, updateMergeOutcomeAtom } from "../src/state/merge-outcome";

type Scenario = "mixed" | "unresolved" | "zero";

class OutcomeWorker extends OsmixWorker {
  add(osm: Osm) {
    this.set(osm.id, osm);
  }
  node(id: string, nodeId: number) {
    return this.get(id).nodes.getById(nodeId);
  }
}

function createSession(scenario: Scenario) {
  const base = new Osm({ id: "outcome-base" });
  base.nodes.addNode({ id: 1, lon: 0, lat: 0, tags: { name: "Old" } });
  const patch = new Osm({ id: "outcome-patch" });
  patch.nodes.addNode({
    id: 101,
    lon: 0.000005,
    lat: 0,
    tags: scenario === "zero" ? { description: "Unselected" } : { name: "Imported" },
  });
  if (scenario === "mixed") {
    for (const node of [
      { id: 2, lon: 0.009997, lat: 0 },
      { id: 3, lon: 0.010003, lat: 0 },
      { id: 4, lon: 0.02, lat: 0 },
      { id: 5, lon: 0.03, lat: 0, tags: { layer: "0" } },
    ])
      base.nodes.addNode(node);
    const importedNodes: OsmNode[] = [
      { id: 201, lon: 0.01, lat: 0, tags: { name: "Ambiguous" } },
      { id: 301, lon: 0.020005, lat: 0, tags: { name: "Skipped" } },
      { id: 401, lon: 0.030005, lat: 0, tags: { layer: "1" } },
      { id: 501, lon: 0.05, lat: 0, tags: { name: "Unmatched" } },
    ];
    for (const node of importedNodes) patch.nodes.addNode(node);
  }
  for (const osm of [base, patch]) {
    osm.buildIndexes();
    osm.buildSpatialIndexes();
  }
  const worker = new OutcomeWorker();
  worker.add(base);
  worker.add(patch);
  const options: OsmConflationOptions = {
    propertyKeys: ["name", "layer", "missing-key"],
    attachNetwork: false,
    automatic: scenario === "unresolved" ? "none" : "high-confidence",
  };
  worker.discoverConflation(base.id, patch.id, options);
  if (scenario === "mixed") {
    worker.setConflationDecision(base.id, { candidateId: "node:301->4", action: "reject" });
  }
  return { worker, base, patch, scenario };
}

/** Real worker generation and production completion atoms, without loading a map or a PBF. */
export function MergeOutcomeHarness() {
  const [session, setSession] = useState(() => createSession("mixed"));
  const [generated, setGenerated] = useState(false);
  const [applied, setApplied] = useState(false);
  const [refreshed, setRefreshed] = useState(false);
  const [failRefresh, setFailRefresh] = useState(false);
  const [failDownload, setFailDownload] = useState(false);
  const [refreshError, setRefreshError] = useState<string | null>(null);
  const completion = useAtomValue(mergeCompletionAtom);
  const updateOutcome = useSetAtom(updateMergeOutcomeAtom);

  useEffect(() => {
    updateOutcome({
      type: "begin",
      inputs: {
        baseName: "outcome-base.pbf",
        patchName: "outcome-patch.pbf",
        matchingEnabled: true,
      },
    });
  }, [session, updateOutcome]);
  useEffect(() => {
    window.mergeOutcomeHarness = {
      readState: () => {
        let reviewAvailable = true;
        try {
          session.worker.getConflationSummary(session.base.id);
        } catch {
          reviewAvailable = false;
        }
        return structuredClone({
          completion,
          applied,
          refreshed,
          reviewAvailable,
          baseName: session.worker.node(session.base.id, 1)?.tags?.["name"],
        });
      },
    };
  }, [session, completion, applied, refreshed]);

  const reset = (scenario: Scenario) => {
    setSession(createSession(scenario));
    setGenerated(false);
    setApplied(false);
    setRefreshed(false);
    setRefreshError(null);
    setFailDownload(false);
    setFailRefresh(false);
  };
  const download = async () => {
    let json = "";
    await writeJsonReport(
      {
        async write(data) {
          if (failDownload) throw Error("Disk full in download test");
          json += data;
        },
        async close() {
          const url = URL.createObjectURL(new Blob([json], { type: "application/json" }));
          const link = document.createElement("a");
          link.href = url;
          link.download = "osmix-merge-outcome.json";
          link.click();
          setTimeout(() => URL.revokeObjectURL(url), 1000);
        },
        async abort() {},
      },
      { format: "osmix-merge-outcome", version: 1, ...completion },
    );
  };

  return (
    <section data-testid="merge-outcome-harness" className="mt-2 flex flex-col gap-2">
      <label>
        Completion scenario
        <select
          value={session.scenario}
          onChange={(event) => {
            const value = event.target.value;
            if (value === "mixed" || value === "unresolved" || value === "zero") reset(value);
          }}
        >
          <option value="mixed">Mixed</option>
          <option value="unresolved">All unresolved</option>
          <option value="zero">No candidates</option>
        </select>
      </label>
      <ActionButton
        disabled={generated || applied}
        onAction={async () => {
          const generation = session.worker.generateConflationChangeset(session.base.id, {
            directMerge: true,
          });
          updateOutcome({ type: "generated", outcome: generation.outcome });
          setGenerated(true);
        }}
      >
        Generate completion preview
      </ActionButton>
      <ActionButton
        disabled={!generated || applied}
        onAction={async () => {
          session.worker.applyChangesAndReplace(session.base.id);
          updateOutcome({ type: "applied" });
          setApplied(true);
          setGenerated(false);
        }}
      >
        Apply completion preview
      </ActionButton>
      <label>
        <input
          type="checkbox"
          checked={failRefresh}
          onChange={(event) => setFailRefresh(event.target.checked)}
        />
        Fail next refresh
      </label>
      <ActionButton
        disabled={!applied || refreshed}
        onAction={async () => {
          if (failRefresh) {
            setRefreshError("Displayed result could not be refreshed");
            setFailRefresh(false);
            return;
          }
          setRefreshError(null);
          updateOutcome({ type: "refreshed" });
          setRefreshed(true);
        }}
      >
        Refresh completion result
      </ActionButton>
      {refreshError ? <p role="alert">{refreshError}</p> : null}
      <ActionButton
        disabled={!refreshed}
        onAction={async () => updateOutcome({ type: "complete" })}
      >
        Finish completion run
      </ActionButton>
      <label>
        <input
          type="checkbox"
          checked={failDownload}
          onChange={(event) => setFailDownload(event.target.checked)}
        />
        Fail report download
      </label>
      {completion ? (
        <MergeCompletionSummary completion={completion} onDownloadReport={download} />
      ) : null}
      <Button onClick={() => reset("mixed")}>Reset completion scenario</Button>
    </section>
  );
}

declare global {
  interface Window {
    mergeOutcomeHarness: {
      readState: () => {
        completion: import("../src/state/merge-outcome").MergeCompletion | null;
        applied: boolean;
        refreshed: boolean;
        reviewAvailable: boolean;
        baseName: string | number | undefined;
      };
    };
  }
}
