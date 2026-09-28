import {
  Alert,
  cn,
  Details,
  DetailsContent,
  DetailsSummary,
  InfoTooltip,
  EmptyState,
} from "@osmix/ui";
import type { OsmConflationCandidate } from "osmix";

const ROUTING_FAMILY_LABEL = {
  "bicycle-shared": "Bicycle or shared-use",
  "motor-road": "Motor road",
  "non-routable": "No routable connection",
  pedestrian: "Pedestrian",
} as const;

/** Missing measurements and an unmatched search express different evidence. */
export function conflationDistanceLabel(candidate: OsmConflationCandidate) {
  if (candidate.targetId == null) {
    return candidate.reasons.includes("unsupported-way-chain")
      ? "Nearby segments cannot form one supported match"
      : "No eligible base target within search radius";
  }
  const distance = candidate.evidence.distanceMeters;
  return Number.isFinite(distance) && distance >= 0
    ? `${distance.toFixed(3)} m`
    : "Distance unavailable for this target";
}

function measurement(value: number, digits: number, unit: string) {
  return Number.isFinite(value) && value >= 0 ? `${value.toFixed(digits)}${unit}` : "Unavailable";
}

export function CandidateEvidence({ candidate }: { candidate: OsmConflationCandidate }) {
  const { evidence } = candidate;
  const measurements = [
    ["Candidate distance", conflationDistanceLabel(candidate)],
    [
      "Imported network use",
      evidence.sourceRoutingFamilies.map((family) => ROUTING_FAMILY_LABEL[family]).join(", ") ||
        "None",
    ],
    [
      "Base network use",
      evidence.targetRoutingFamilies.map((family) => ROUTING_FAMILY_LABEL[family]).join(", ") ||
        "None",
    ],
  ];
  if (evidence.bearingDifferenceDegrees !== undefined)
    measurements.push([
      "Direction difference",
      measurement(evidence.bearingDifferenceDegrees, 1, "°"),
    ]);
  if (evidence.lengthDifferenceRatio !== undefined)
    measurements.push([
      "Length difference",
      measurement(evidence.lengthDifferenceRatio * 100, 1, "%"),
    ]);
  if (evidence.maxGeometryDistanceMeters !== undefined)
    measurements.push([
      "Maximum geometry distance",
      measurement(evidence.maxGeometryDistanceMeters, 3, " m"),
    ]);

  return (
    <Details>
      <DetailsSummary className="h-auto min-h-8 gap-2 text-left">
        Match evidence and attributes
      </DetailsSummary>
      <DetailsContent>
        <section aria-label="Match evidence" className="flex min-w-0 flex-col gap-2 p-inset">
          <p className="flex items-center gap-1 text-muted-foreground">
            Nearby features can represent different things. Distance alone does not prove a match or
            a safe connection.
            <InfoTooltip label="About candidate evidence metrics" side="right" align="start">
              Point distance compares two locations. Way distance measures the largest sampled
              separation between their geometries. Network use describes allowed travel; direction
              and length differences provide further evidence. OSM tags are feature attributes. An
              OSM relation groups features, such as a route or turn restriction.
            </InfoTooltip>
          </p>
          <dl className="grid min-w-0 grid-cols-2 gap-x-2 gap-y-1">
            {measurements.map(([label, value]) => (
              <div key={label} className="contents">
                <dt className="min-w-0 wrap-break-word text-muted-foreground">{label}</dt>
                <dd className="min-w-0 wrap-break-word select-all">{value}</dd>
              </div>
            ))}
          </dl>
        </section>
        {evidence.featureTypeConflicts && evidence.featureTypeConflicts.length > 0 ? (
          <Alert
            aria-label="Feature type conflict"
            className="m-inset min-w-0"
            role="region"
            title="Feature type conflict"
            variant="destructive"
          >
            <p>
              These classifications block matching actions, even when they are not selected for
              copying.
            </p>
            {evidence.featureTypeConflicts.map((conflict) => (
              <div key={conflict.key} className="flex min-w-0 flex-col gap-1">
                <p className="font-mono font-semibold break-all select-all">{conflict.key}</p>
                <dl className="flex min-w-0 flex-col gap-1">
                  <dt className="text-muted-foreground">Base classification</dt>
                  <dd className="min-w-0 break-all select-all">{String(conflict.baseValue)}</dd>
                  <dt className="text-muted-foreground">Imported classification</dt>
                  <dd className="min-w-0 break-all select-all">{String(conflict.patchValue)}</dd>
                </dl>
              </div>
            ))}
          </Alert>
        ) : null}
        {evidence.tagDiff.length > 0 ? (
          <section aria-label="Attribute differences" className="flex min-w-0 flex-col">
            {evidence.tagDiff.map((diff) => (
              <div
                key={diff.key}
                className={cn(
                  "flex min-w-0 flex-col gap-1 border-t p-inset",
                  diff.protected && "bg-destructive/10",
                  !diff.protected && diff.routing && "bg-warning/10",
                )}
              >
                <p className="font-mono font-semibold break-all select-all">{diff.key}</p>
                {diff.protected ? (
                  <p>Protected attribute: this value cannot be copied.</p>
                ) : diff.routing ? (
                  <p>Affects travel: review before copying.</p>
                ) : null}
                <dl className="flex min-w-0 flex-col gap-1">
                  <dt className="text-muted-foreground">Base value</dt>
                  <dd className="min-w-0 break-all select-all">
                    {String(diff.baseValue ?? "not set")}
                  </dd>
                  <dt className="text-muted-foreground">Imported value</dt>
                  <dd className="min-w-0 break-all select-all">{String(diff.patchValue)}</dd>
                </dl>
              </div>
            ))}
          </section>
        ) : (
          <EmptyState>No selected attribute differences</EmptyState>
        )}
      </DetailsContent>
    </Details>
  );
}
