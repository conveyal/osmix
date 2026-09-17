import { Button } from "@osmix/ui";
import { useAtomValue } from "jotai";
import type { StyleSpecification } from "maplibre-gl";
import {
  Osm,
  type OsmConflationCandidateFilter,
  type OsmConflationDecision,
  OsmixWorker,
} from "osmix";
import { useEffect, useRef, useState } from "react";
import { Map, MapProvider, type MapRef } from "react-map-gl/maplibre";

import { ConflationComparisonLayer } from "../src/components/conflation-comparison-layer";
import { ConflationConfig } from "../src/components/conflation-config";
import { ConflationReview } from "../src/components/conflation-review";
import { conflationComparisonAtom } from "../src/state/conflation";
import { createHarnessStore, useHarnessSession } from "./harness-store";

type Scenario =
  | "finite"
  | "unmatched"
  | "unavailable"
  | "missing"
  | "coincident"
  | "way"
  | "feature-conflict"
  | "alternatives";

class EvidenceWorker extends OsmixWorker {
  add(osm: Osm) {
    this.set(osm.id, osm);
  }
}

function createSession(scenario: Scenario) {
  const base = new Osm({ id: `evidence-base-${scenario}` });
  base.nodes.addNode({
    id: 1,
    lon: -120.5,
    lat: 46.6,
    tags:
      scenario === "feature-conflict"
        ? { name: "Base cafe", amenity: "cafe" }
        : { name: "Base entrance" },
  });
  if (scenario === "alternatives") {
    base.nodes.addNode({ id: 2, lon: -120.49999, lat: 46.6, tags: { name: "Other entrance" } });
  }
  base.nodes.addNode({ id: 21, lon: -120.5001, lat: 46.6001 });
  base.nodes.addNode({ id: 22, lon: -120.4999, lat: 46.6001 });
  base.nodes.buildIndex();
  base.ways.addWay({
    id: 10,
    refs: scenario === "feature-conflict" ? [1, 21, 22] : [21, 22],
    tags: { highway: "footway", name: "Base path" },
  });
  base.buildIndexes();
  base.buildSpatialIndexes();

  const patch = new Osm({ id: `evidence-patch-${scenario}` });
  patch.nodes.addNode({
    id: 101,
    lon: scenario === "unmatched" ? -120.49 : scenario === "coincident" ? -120.5 : -120.499995,
    lat: 46.6,
    tags:
      scenario === "feature-conflict"
        ? { name: "Imported school", amenity: "school" }
        : { name: "Imported entrance" },
  });
  patch.nodes.addNode({ id: 102, lon: -120.500095, lat: 46.6001 });
  patch.nodes.addNode({ id: 103, lon: -120.499895, lat: 46.6001 });
  patch.nodes.buildIndex();
  patch.ways.addWay({
    id: 20,
    refs: scenario === "feature-conflict" ? [101, 102, 103] : [102, 103],
    tags: {
      highway: "footway",
      name: "Imported_accessible_path_with_a_very_long_unbroken_attribute_value_for_narrow_panels",
    },
  });
  patch.buildIndexes();
  patch.buildSpatialIndexes();

  const worker = new EvidenceWorker();
  worker.add(base);
  worker.add(patch);
  worker.discoverConflation(base.id, patch.id, {
    propertyKeys: ["name"],
    attachNetwork: scenario === "feature-conflict",
    maxDistanceMeters: 2,
  });
  const filter: OsmConflationCandidateFilter = { entityType: scenario === "way" ? "way" : "node" };
  worker.setConflationFilter(base.id, filter);
  return {
    base,
    patch,
    worker,
    filter,
    scenario,
    decisions: [] as OsmConflationDecision[],
    page: 0,
    delayNextChoice: false,
    completeChoice: null as (() => void) | null,
    decisionCalls: 0,
  };
}

const EMPTY_STYLE: StyleSpecification = {
  version: 8,
  sources: {},
  layers: [{ id: "background", type: "background", paint: { "background-color": "#f5f5f4" } }],
};

const store = createHarnessStore(() => createSession("finite"));

function EvidenceContent() {
  const session = useHarnessSession(store);
  const [mapLoaded, setMapLoaded] = useState(false);
  const comparison = useAtomValue(conflationComparisonAtom);
  const mapRef = useRef<MapRef>(null);
  const page = session.worker.getConflationPage(session.base.id, session.page, 5, {
    groupBySource: true,
  });
  // Exercise persisted/external evidence that lacks a usable measurement, without changing discovery.
  if (session.scenario === "unavailable" || session.scenario === "missing") {
    for (const candidate of page.candidates) {
      if (session.scenario === "missing")
        Reflect.deleteProperty(candidate.evidence, "distanceMeters");
      else candidate.evidence.distanceMeters = Number.NaN;
    }
  }

  useEffect(() => {
    window.conflationEvidenceHarness = {
      readState: () => ({
        comparison: structuredClone(comparison),
        decisions: structuredClone(session.decisions),
        mapLoaded,
        layers: mapRef.current?.getMap().getStyle().layers ?? [],
        sources: mapRef.current?.getMap().getStyle().sources ?? {},
        decisionCalls: session.decisionCalls,
        mapMoving: mapRef.current?.getMap().isMoving() ?? false,
      }),
      completeChoice: () => store.current.completeChoice?.(),
    };
  }, [comparison, mapLoaded, session]);

  return (
    <main
      className="flex w-full max-w-[512px] min-w-0 flex-col gap-2 p-2"
      data-testid="evidence-harness"
    >
      <div className="flex flex-wrap gap-1">
        {(
          [
            ["finite", "Finite point pair"],
            ["unmatched", "No eligible target"],
            ["unavailable", "Unavailable distance"],
            ["missing", "Missing distance"],
            ["coincident", "Coincident point pair"],
            ["way", "Way pair"],
            ["feature-conflict", "Nearby school and cafe"],
            ["alternatives", "Alternative point targets"],
          ] as const
        ).map(([scenario, label]) => (
          <Button
            key={scenario}
            variant="outline"
            onClick={() => store.replace(createSession(scenario))}
          >
            {label}
          </Button>
        ))}
      </div>
      <Button
        variant="outline"
        onClick={() =>
          store.mutate((current) => {
            current.delayNextChoice = true;
          })
        }
      >
        Delay next matching choice
      </Button>
      <ConflationConfig />
      <div className="h-64 w-full" data-testid="evidence-map">
        <Map
          ref={mapRef}
          initialViewState={{ longitude: -120.5, latitude: 46.6, zoom: 19 }}
          mapStyle={EMPTY_STYLE}
          attributionControl={false}
          onLoad={() => setMapLoaded(true)}
        >
          <ConflationComparisonLayer />
        </Map>
      </div>
      <div data-testid="evidence-review">
        <ConflationReview
          base={session.base}
          patch={session.patch}
          summary={session.worker.getConflationSummary(session.base.id)}
          page={page}
          filter={session.filter}
          isFilterPending={false}
          onDecision={async (decision) => {
            store.mutate((current) => {
              current.decisionCalls++;
            });
            if (store.current.delayNextChoice) {
              store.mutate((current) => {
                current.delayNextChoice = false;
              });
              await new Promise<void>((resolve) => {
                store.mutate((current) => {
                  current.completeChoice = resolve;
                });
              });
              store.mutate((current) => {
                current.completeChoice = null;
              });
            }
            const candidate = page.candidates.find((row) => row.id === decision.candidateId);
            if (!candidate) throw Error("Missing comparison candidate");
            store.mutate((current) => {
              current.decisions = current.worker.setConflationSourceDecision(
                current.base.id,
                candidate,
                decision,
              ).decisions;
            });
          }}
          onLeaveUnmatched={async (source) => {
            store.mutate((current) => {
              current.decisions = current.worker.setConflationSourceDecision(
                current.base.id,
                source,
                null,
              ).decisions;
            });
          }}
          onResetDecision={async (candidateId) => {
            store.mutate((current) => {
              current.decisions = current.decisions.filter(
                (decision) => decision.candidateId !== candidateId,
              );
              current.worker.setConflationDecisions(current.base.id, current.decisions);
            });
          }}
          onBulkDecision={async (request) => {
            store.mutate((current) => {
              current.decisions = current.worker.applyConflationBulkDecision(
                current.base.id,
                request,
              ).decisions;
            });
          }}
          onFilterChange={async (filter) => {
            store.mutate((current) => {
              current.filter = filter;
              current.worker.setConflationFilter(current.base.id, filter);
              current.page = 0;
            });
          }}
          onPageChange={async (pageNumber) => {
            store.mutate((current) => {
              current.page = pageNumber;
            });
          }}
        />
      </div>
    </main>
  );
}

export function ConflationEvidenceHarness() {
  return (
    <MapProvider>
      <EvidenceContent />
    </MapProvider>
  );
}

declare global {
  interface Window {
    conflationEvidenceHarness: {
      completeChoice: () => void;
      readState: () => {
        comparison: GeoJSON.FeatureCollection;
        decisions: OsmConflationDecision[];
        mapLoaded: boolean;
        layers: StyleSpecification["layers"];
        sources: StyleSpecification["sources"];
        decisionCalls: number;
        mapMoving: boolean;
      };
    };
  }
}
