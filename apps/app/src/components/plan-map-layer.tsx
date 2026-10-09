import { APPID, MIN_PICKABLE_ZOOM, planTileUrl, useMapColors } from "@osmix/app-components";
import { useAtomValue } from "jotai";
import type {
  CircleLayerSpecification,
  ExpressionSpecification,
  LineLayerSpecification,
  MapLayerMouseEvent,
} from "maplibre-gl";
import { type MergePlanFeatureDetail, PLAN_TILE_LAYERS, type PlanOutcome } from "osmix";
import { useEffect } from "react";
import { Layer, Source, useMap } from "react-map-gl/maplibre";

import { OUTCOME_LABEL, OUTCOMES } from "../lib/merge-plan-workflow";
import {
  planFilterAtom,
  planMapAtom,
  planOverviewAtom,
  selectedPlanFeatureAtom,
} from "../state/merge-plan";

const SOURCE_ID = `${APPID}:merge-plan`;
const SELECTION_ID = `${APPID}:merge-plan-selection`;
const TARGETS_ID = `${APPID}:merge-plan-targets`;
const LINES_ID = `${SOURCE_ID}:lines`;
const POINTS_ID = `${SOURCE_ID}:points`;
/** The plan's lowest layer: the selection's base lines go under it, above the faded inputs. */
const PLAN_BOTTOM_ID = `${SOURCE_ID}:casing`;

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
 * its row in the review. The worker draws the tiles from the live plan, from the zoom where
 * features become selectable; a new revision refetches them after the plan changes.
 */
export function PlanMapLayer({ onSelect }: { onSelect: (featureKey: string) => unknown }) {
  const planMap = useAtomValue(planMapAtom);
  const group = useAtomValue(planFilterAtom).group;
  const selected = useAtomValue(selectedPlanFeatureAtom);
  const colors = useMapColors();
  const map = useMap().current;

  useEffect(() => {
    if (!map || !planMap) return;
    const layers = [LINES_ID, `${LINES_ID}:decision`, POINTS_ID];
    const handleClick = (event: MapLayerMouseEvent) => {
      const key = event.features?.[0]?.properties?.["featureKey"];
      if (typeof key === "string") void onSelect(key);
    };
    map.on("click", layers, handleClick);
    return () => {
      map.off("click", layers, handleClick);
    };
  }, [map, planMap, onSelect]);

  if (!planMap) return null;
  const replaced = replacedLines(selected);
  const targets = targetFeatures(selected);
  const color = outcomeColor(colors);
  const isSelected: ExpressionSpecification = ["==", ["get", "featureKey"], selected?.key ?? ""];
  const decision: ExpressionSpecification = ["==", ["get", "outcome"], "needs-decision"];
  // Showing one group of features that wait narrows the map to it too.
  const shown: ExpressionSpecification = group
    ? ["==", ["get", "group"], group]
    : ["literal", true];
  const linePaint: LineLayerSpecification["paint"] = {
    "line-color": color,
    "line-width": ["case", isSelected, 7, decision, 5, 3],
  };
  const pointPaint: CircleLayerSpecification["paint"] = {
    "circle-color": color,
    "circle-radius": ["case", isSelected, 8, decision, 6, 4],
    "circle-stroke-color": ["case", isSelected, colors.selected, colors.casing],
    "circle-stroke-width": ["case", isSelected, 3, 1.5],
  };
  return (
    <>
      <Source
        key={planMap.baseOsmId}
        id={SOURCE_ID}
        type="vector"
        tiles={[planTileUrl(planMap.baseOsmId, planMap.revision)]}
        minzoom={MIN_PICKABLE_ZOOM}
        maxzoom={14}
        {...(planMap.bounds ? { bounds: planMap.bounds } : {})}
      >
        <Layer
          id={`${SOURCE_ID}:casing`}
          type="line"
          source-layer={PLAN_TILE_LAYERS.ways}
          filter={shown}
          paint={{
            "line-color": ["case", isSelected, colors.selected, colors.casing],
            "line-width": ["case", isSelected, 13, 6],
          }}
        />
        <Layer
          id={LINES_ID}
          type="line"
          source-layer={PLAN_TILE_LAYERS.ways}
          filter={["all", shown, ["!", decision]]}
          paint={linePaint}
        />
        <Layer
          id={`${LINES_ID}:decision`}
          type="line"
          source-layer={PLAN_TILE_LAYERS.ways}
          filter={["all", shown, decision]}
          paint={{ ...linePaint, "line-dasharray": [1.5, 1] }}
        />
        <Layer
          id={POINTS_ID}
          type="circle"
          source-layer={PLAN_TILE_LAYERS.nodes}
          filter={shown}
          paint={pointPaint}
        />
      </Source>
      {/* After the plan source, so their layers can go under its lowest one by ID. */}
      {replaced.features.length > 0 ? (
        // The base ways the selected feature would replace, as base data: solid, in base ink,
        // cased in the selection color, under the plan's lines and above the faded inputs.
        <Source id={SELECTION_ID} type="geojson" data={replaced}>
          <Layer
            id={`${SELECTION_ID}:casing`}
            type="line"
            beforeId={PLAN_BOTTOM_ID}
            paint={{ "line-color": colors.selected, "line-width": 11 }}
          />
          <Layer
            id={`${SELECTION_ID}:lines`}
            type="line"
            beforeId={PLAN_BOTTOM_ID}
            paint={{ "line-color": colors.base, "line-width": 5 }}
          />
        </Source>
      ) : null}
      {targets.features.length > 0 ? (
        // The base features the selected feature's proposals match, as base data: solid lines
        // and hollow points in base ink, like the base dataset's own legend symbols.
        <Source id={TARGETS_ID} type="geojson" data={targets}>
          <Layer
            id={`${TARGETS_ID}:casing`}
            type="line"
            beforeId={PLAN_BOTTOM_ID}
            filter={["==", ["geometry-type"], "LineString"]}
            paint={{ "line-color": colors.selected, "line-width": 9 }}
          />
          <Layer
            id={`${TARGETS_ID}:lines`}
            type="line"
            beforeId={PLAN_BOTTOM_ID}
            filter={["==", ["geometry-type"], "LineString"]}
            paint={{ "line-color": colors.base, "line-width": 3 }}
          />
          {/* Points go on top: a base node under an imported vertex would otherwise hide. */}
          <Layer
            id={`${TARGETS_ID}:points`}
            type="circle"
            filter={["==", ["geometry-type"], "Point"]}
            paint={{
              "circle-color": colors.casing,
              "circle-radius": 8,
              "circle-stroke-color": colors.base,
              "circle-stroke-width": 3,
            }}
          />
        </Source>
      ) : null}
    </>
  );
}

/** The base ways the selected feature's replacements would delete, as GeoJSON lines. */
function replacedLines(
  selected: MergePlanFeatureDetail | null,
): GeoJSON.FeatureCollection<GeoJSON.LineString> {
  const lines = Object.values(selected?.replaces ?? {}).flat();
  return {
    type: "FeatureCollection",
    features: lines.map((coordinates) => ({
      type: "Feature",
      properties: {},
      geometry: { type: "LineString", coordinates },
    })),
  };
}

/**
 * The base entities the selected feature's proposals target, once each: a base node as a point,
 * a base way as a line. Relations have no coordinates and are not drawn.
 */
function targetFeatures(selected: MergePlanFeatureDetail | null): GeoJSON.FeatureCollection {
  const seen = new Set<string>();
  const features: GeoJSON.Feature[] = [];
  for (const coordinates of Object.values(selected?.targets ?? {})) {
    const key = JSON.stringify(coordinates);
    if (coordinates.length === 0 || seen.has(key)) continue;
    seen.add(key);
    features.push({
      type: "Feature",
      properties: {},
      geometry:
        coordinates.length === 1
          ? { type: "Point", coordinates: coordinates[0]! }
          : { type: "LineString", coordinates },
    });
  }
  return { type: "FeatureCollection", features };
}

/**
 * The plan layer's key, in the map legend under the dataset rows: each outcome's colour next
 * to its name and count, for the outcomes the plan has. Shown while the plan layer is drawn.
 */
export function PlanLegend() {
  const planMap = useAtomValue(planMapAtom);
  const overview = useAtomValue(planOverviewAtom);
  const selected = useAtomValue(selectedPlanFeatureAtom);
  if (!planMap || !overview) return null;
  const counts = overview.summary.features;
  const replacing = replacedLines(selected).features.length;
  const matched = targetFeatures(selected).features.length;
  return (
    <ul className="flex flex-col border-t py-1" aria-label="Plan map legend">
      {OUTCOMES.filter((outcome) => counts[outcome] > 0).map((outcome) => (
        <li key={outcome} className="flex h-7 items-center gap-2 px-inset">
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
      {matched > 0 ? (
        <li className="flex h-7 items-center gap-2 px-inset">
          <svg aria-hidden="true" width="24" height="12" viewBox="0 0 24 12">
            <line x1="1" y1="6" x2="23" y2="6" stroke="var(--map-base)" strokeWidth={2} />
            <circle
              cx="12"
              cy="6"
              r="4"
              fill="var(--map-casing)"
              stroke="var(--map-base)"
              strokeWidth={2}
            />
          </svg>
          <span>Base {matched === 1 ? "feature" : "features"} the selected feature matches</span>
        </li>
      ) : null}
      {replacing > 0 ? (
        <li className="flex h-7 items-center gap-2 px-inset">
          <svg aria-hidden="true" width="24" height="12" viewBox="0 0 24 12">
            <line x1="1" y1="6" x2="23" y2="6" stroke="var(--map-base)" strokeWidth={3} />
          </svg>
          <span>Base {replacing === 1 ? "way" : "ways"} the selected feature replaces</span>
        </li>
      ) : null}
    </ul>
  );
}
