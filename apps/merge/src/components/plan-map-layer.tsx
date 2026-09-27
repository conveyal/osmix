import { APPID, useMapColors } from "@osmix/app-components";
import { useAtomValue } from "jotai";
import type {
  CircleLayerSpecification,
  ExpressionSpecification,
  LineLayerSpecification,
  MapLayerMouseEvent,
} from "maplibre-gl";
import type { PlanOutcome } from "osmix";
import { useEffect } from "react";
import { Layer, Source, useMap } from "react-map-gl/maplibre";

import { OUTCOME_LABEL, OUTCOMES } from "../lib/merge-plan-workflow";
import { planLayerAtom, selectedPlanFeatureAtom } from "../state/merge-plan";

const SOURCE_ID = `${APPID}:merge-plan`;
const LINES_ID = `${SOURCE_ID}:lines`;
const POINTS_ID = `${SOURCE_ID}:points`;

const OUTCOME_TOKEN: Record<PlanOutcome, string> = {
  "needs-decision": "--map-outcome-decision",
  removed: "--map-outcome-removed",
  merged: "--map-outcome-merged",
  connected: "--map-outcome-connected",
  replaced: "--map-outcome-replaced",
  added: "--map-outcome-added",
  unchanged: "--map-outcome-unchanged",
};

function outcomeColor(colors: ReturnType<typeof useMapColors>): ExpressionSpecification {
  return [
    "match",
    ["get", "outcome"],
    "needs-decision",
    colors.outcomeDecision,
    "removed",
    colors.outcomeRemoved,
    "merged",
    colors.outcomeMerged,
    "connected",
    colors.outcomeConnected,
    "replaced",
    colors.outcomeReplaced,
    "added",
    colors.outcomeAdded,
    colors.outcomeUnchanged,
  ];
}

/**
 * The plan on the map: every imported feature coloured by outcome, with features that need a
 * decision drawn wider and dashed, so colour is never the only cue. Clicking a feature opens
 * its row in the review.
 */
export function PlanMapLayer({ onSelect }: { onSelect: (featureKey: string) => unknown }) {
  const layer = useAtomValue(planLayerAtom);
  const selected = useAtomValue(selectedPlanFeatureAtom);
  const colors = useMapColors();
  const map = useMap().current;

  useEffect(() => {
    if (!map || !layer) return;
    const layers = [LINES_ID, POINTS_ID];
    const handleClick = (event: MapLayerMouseEvent) => {
      const key = event.features?.[0]?.properties?.["featureKey"];
      if (typeof key === "string") void onSelect(key);
    };
    map.on("click", layers, handleClick);
    return () => {
      map.off("click", layers, handleClick);
    };
  }, [map, layer, onSelect]);

  if (!layer) return null;
  const color = outcomeColor(colors);
  const isSelected: ExpressionSpecification = ["==", ["get", "featureKey"], selected?.key ?? ""];
  const decision: ExpressionSpecification = ["==", ["get", "outcome"], "needs-decision"];
  const linePaint: LineLayerSpecification["paint"] = {
    "line-color": color,
    "line-width": ["case", isSelected, 7, decision, 5, 3],
  };
  const pointPaint: CircleLayerSpecification["paint"] = {
    "circle-color": color,
    "circle-radius": ["case", isSelected, 8, decision, 6, 4],
    "circle-stroke-color": colors.casing,
    "circle-stroke-width": 1.5,
  };
  return (
    <Source id={SOURCE_ID} type="geojson" data={layer}>
      <Layer
        id={`${SOURCE_ID}:casing`}
        type="line"
        filter={["==", ["geometry-type"], "LineString"]}
        paint={{ "line-color": colors.casing, "line-width": ["case", isSelected, 11, 6] }}
      />
      <Layer
        id={LINES_ID}
        type="line"
        filter={["all", ["==", ["geometry-type"], "LineString"], ["!", decision]]}
        paint={linePaint}
      />
      <Layer
        id={`${LINES_ID}:decision`}
        type="line"
        filter={["all", ["==", ["geometry-type"], "LineString"], decision]}
        paint={{ ...linePaint, "line-dasharray": [1.5, 1] }}
      />
      <Layer
        id={POINTS_ID}
        type="circle"
        filter={["==", ["geometry-type"], "Point"]}
        paint={pointPaint}
      />
    </Source>
  );
}

/** The plan layer's key: each outcome's colour next to its name. */
export function PlanLegend({ counts }: { counts: Record<PlanOutcome, number> }) {
  return (
    <ul className="flex flex-col gap-1" aria-label="Plan map legend">
      {OUTCOMES.filter((outcome) => counts[outcome] > 0).map((outcome) => (
        <li key={outcome} className="flex items-center gap-2">
          <svg aria-hidden="true" width="24" height="12" viewBox="0 0 24 12">
            <line
              x1="1"
              y1="6"
              x2="23"
              y2="6"
              stroke={`var(${OUTCOME_TOKEN[outcome]})`}
              strokeWidth={outcome === "needs-decision" ? 4 : 3}
              strokeDasharray={outcome === "needs-decision" ? "3 2" : undefined}
            />
          </svg>
          <span>
            {OUTCOME_LABEL[outcome]} ({counts[outcome].toLocaleString()})
          </span>
        </li>
      ))}
    </ul>
  );
}
