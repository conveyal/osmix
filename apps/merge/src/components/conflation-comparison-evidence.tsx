import { MapRoleSymbol } from "@osmix/app-components";
import { SectionTitle } from "@osmix/ui";
import type { FeatureCollection } from "geojson";
import type { OsmConflationCandidateView } from "osmix";

import {
  comparisonCoordinate,
  comparisonForCandidate,
  comparisonLocations,
  type ConflationComparisonRole,
} from "../lib/conflation-comparison";

/**
 * The map marker for a comparison role: the base (`target`) is the map's base point symbol (a
 * ring), the imported feature (`source`) its patch point symbol (a diamond that fits inside the
 * ring), so markers, legend and map agree and a co-located pair stays visible.
 */
export function ComparisonMarkerSymbol({ role }: { role: ConflationComparisonRole }) {
  return (
    <MapRoleSymbol
      role={role === "target" ? "base" : "patch"}
      variant="point"
      size={28}
      data-slot="comparison-marker-symbol"
      data-role={role}
    />
  );
}

export function ConflationComparisonLegend() {
  return (
    <div className="flex flex-col gap-1" role="group" aria-label="Map comparison legend">
      <div className="flex flex-wrap gap-x-3 gap-y-1">
        <span className="flex items-center gap-1">
          <ComparisonMarkerSymbol role="target" />
          <span>Base OSM: circle, solid line</span>
        </span>
        <span className="flex items-center gap-1">
          <ComparisonMarkerSymbol role="source" />
          <span>Imported feature: diamond, dashed line</span>
        </span>
      </div>
      <p className="text-muted-foreground">
        At the same location, the diamond sits inside the circle. Way markers show the start and
        end.
      </p>
    </div>
  );
}

export function ConflationComparisonEvidence({
  comparison,
  candidate,
}: {
  comparison: FeatureCollection;
  candidate: OsmConflationCandidateView;
}) {
  const locations = comparisonLocations(comparisonForCandidate(comparison, candidate.id));
  return (
    <section className="flex flex-col gap-2 border-t p-inset" aria-label="Selected map comparison">
      <SectionTitle>Map comparison</SectionTitle>
      <ConflationComparisonLegend />
      <p className="text-muted-foreground">
        Coordinates are latitude and longitude in WGS 84 decimal degrees.
      </p>
      {(["target", "source"] as const).map((role) => {
        const label = role === "target" ? "Base OSM" : "Imported feature";
        const id = role === "target" ? candidate.targetId : candidate.sourceId;
        const points = locations.filter((location) => location.role === role);
        return (
          <div
            key={role}
            className="flex min-w-0 flex-col gap-1"
            role="group"
            aria-label={`${label} coordinates`}
          >
            <p className="font-semibold">
              {label}
              {id == null ? "" : ` (${candidate.entityType} ${id})`}
            </p>
            {points.length === 0 ? (
              <p className="text-muted-foreground">
                {id == null
                  ? "No base target was proposed."
                  : "Coordinates unavailable for this feature."}
              </p>
            ) : (
              points.map((point) => (
                <div key={point.location} className="flex flex-col gap-1">
                  {candidate.entityType === "way" ? <p>{point.location}</p> : null}
                  <dl className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-2 gap-y-1">
                    <dt>Latitude</dt>
                    <dd className="font-mono break-all select-all">
                      {comparisonCoordinate(point.latitude)}
                    </dd>
                    <dt>Longitude</dt>
                    <dd className="font-mono break-all select-all">
                      {comparisonCoordinate(point.longitude)}
                    </dd>
                  </dl>
                </div>
              ))
            )}
          </div>
        );
      })}
    </section>
  );
}
