import { createStore } from "jotai";
import { Osm, type OsmConflationCandidateView } from "osmix";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import {
  ComparisonMarkerSymbol,
  ConflationComparisonEvidence,
  ConflationComparisonLegend,
} from "../src/components/conflation-comparison-evidence";
import {
  comparisonBounds,
  comparisonCoordinate,
  comparisonForCandidate,
  comparisonLocations,
  createConflationComparison,
} from "../src/lib/conflation-comparison";
import { conflationComparisonAtom, resetConflationReviewAtom } from "../src/state/conflation";

function fixture() {
  const base = new Osm({ id: "comparison-base" });
  base.nodes.addNode({ id: 1, lon: -120.5, lat: 46.5 });
  base.nodes.addNode({ id: 2, lon: -120.499, lat: 46.501 });
  base.nodes.addNode({ id: 3, lon: -120.49, lat: 46.51 });
  base.nodes.buildIndex();
  base.ways.addWay({ id: 10, refs: [1, 3, 2], tags: { highway: "footway" } });
  base.buildIndexes();
  const patch = new Osm({ id: "comparison-import" });
  patch.nodes.addNode({ id: 101, lon: -120.5, lat: 46.5 });
  patch.nodes.addNode({ id: 102, lon: -120.498, lat: 46.502 });
  patch.nodes.buildIndex();
  patch.ways.addWay({ id: 20, refs: [101, 102], tags: { highway: "footway" } });
  patch.ways.addWay({ id: 21, refs: [101, 102, 101], tags: { highway: "footway" } });
  patch.ways.addWay({ id: 22, refs: [101, 999], tags: { highway: "footway" } });
  patch.buildIndexes();
  return { base, patch };
}

function candidate(
  entityType: "node" | "way" = "node",
  sourceId = 101,
  targetId: number | null = 1,
): OsmConflationCandidateView {
  return {
    id: `${entityType}:${sourceId}->${targetId ?? "unmatched"}`,
    entityType,
    sourceId,
    targetId,
    status: targetId == null ? "unmatched" : "review",
    reasons: [],
    propertyTransfer: { status: "review", reasons: [] },
    networkAttachment: null,
    evidence: {
      distanceMeters: targetId == null ? Infinity : 0,
      tagDiff: [],
      sourceRoutingFamilies: ["pedestrian"],
      targetRoutingFamilies: ["pedestrian"],
    },
  };
}

function evidenceMarkup(
  comparison: ReturnType<typeof createConflationComparison>,
  match: OsmConflationCandidateView,
) {
  return renderToStaticMarkup(
    createElement(ConflationComparisonEvidence, { comparison, candidate: match }),
  );
}

describe("matching map and coordinate evidence", () => {
  it("keeps both roles at their real coordinates when point features coincide", () => {
    const { base, patch } = fixture();
    const match = candidate();
    const comparison = createConflationComparison(base, patch, match);
    expect(comparison.features.map((feature) => feature.geometry)).toEqual([
      { type: "Point", coordinates: [-120.5, 46.5] },
      { type: "Point", coordinates: [-120.5, 46.5] },
    ]);
    expect(comparisonLocations(comparison)).toEqual([
      {
        candidateId: match.id,
        entityId: 1,
        role: "target",
        location: "Point",
        longitude: -120.5,
        latitude: 46.5,
      },
      {
        candidateId: match.id,
        entityId: 101,
        role: "source",
        location: "Point",
        longitude: -120.5,
        latitude: 46.5,
      },
    ]);
    expect(comparisonBounds(comparison)).toEqual([-120.5, 46.5, -120.5, 46.5]);
    const html = evidenceMarkup(comparison, match);
    expect(html).toContain('aria-label="Base OSM coordinates"');
    expect(html).toContain('aria-label="Imported feature coordinates"');
    expect(html.match(/<dt>Latitude<\/dt>/g)).toHaveLength(2);
    expect(html.match(/<dt>Longitude<\/dt>/g)).toHaveLength(2);
    expect(html.match(/class="select-all break-all"/g)).toHaveLength(4);
    expect(html).toContain("46.5000000°");
    expect(html).toContain("-120.5000000°");
  });

  it("labels actual way endpoints and includes intermediate bends in map bounds", () => {
    const { base, patch } = fixture();
    const match = candidate("way", 20, 10);
    const comparison = createConflationComparison(base, patch, match);
    expect(
      comparisonLocations(comparison).map(({ role, location, longitude, latitude }) => ({
        role,
        location,
        longitude,
        latitude,
      })),
    ).toEqual([
      { role: "target", location: "Start", longitude: -120.5, latitude: 46.5 },
      { role: "target", location: "End", longitude: -120.499, latitude: 46.501 },
      { role: "source", location: "Start", longitude: -120.5, latitude: 46.5 },
      { role: "source", location: "End", longitude: -120.498, latitude: 46.502 },
    ]);
    expect(comparisonBounds(comparison)).toEqual([-120.5, 46.5, -120.49, 46.51]);
    const html = evidenceMarkup(comparison, match);
    expect(html.match(/<p>Start<\/p>/g)).toHaveLength(2);
    expect(html.match(/<p>End<\/p>/g)).toHaveLength(2);
    expect(html).not.toMatch(/>Center<|>Centroid</i);
  });

  it("identifies the shared start and end of a closed way without duplicating its marker", () => {
    const { base, patch } = fixture();
    const match = candidate("way", 21, null);
    const comparison = createConflationComparison(base, patch, match);
    expect(comparisonLocations(comparison)).toEqual([
      {
        candidateId: match.id,
        entityId: 21,
        role: "source",
        location: "Start and end",
        longitude: -120.5,
        latitude: 46.5,
      },
    ]);
    expect(evidenceMarkup(comparison, match)).toContain("Start and end");
  });

  it("shows a missing target without inventing coordinates", () => {
    const { base, patch } = fixture();
    const match = candidate("node", 101, null);
    const comparison = createConflationComparison(base, patch, match);
    expect(comparison.features).toHaveLength(1);
    expect(comparisonLocations(comparison).map((point) => point.role)).toEqual(["source"]);
    expect(evidenceMarkup(comparison, match)).toContain("No base target was proposed.");
    const missing = candidate("node", 101, 999);
    expect(evidenceMarkup(createConflationComparison(base, patch, missing), missing)).toContain(
      "Coordinates unavailable for this feature.",
    );
  });

  it.each([
    [0, 91],
    [0, -91],
    [181, 0],
    [-181, 0],
  ])(
    "omits invalid WGS 84 coordinates %s,%s from points, ways, markers and bounds",
    (longitude, latitude) => {
      const { base, patch } = fixture();
      const malformed = new Osm({ id: "invalid-coordinate-import" });
      malformed.nodes.addNode({ id: 101, lon: longitude, lat: latitude });
      malformed.nodes.addNode({ id: 102, lon: 0, lat: 0 });
      malformed.nodes.buildIndex();
      malformed.ways.addWay({ id: 20, refs: [102, 101], tags: { highway: "footway" } });
      malformed.buildIndexes();
      for (const match of [candidate("node", 101, null), candidate("way", 20, null)]) {
        const comparison = createConflationComparison(base, malformed, match);
        expect(comparison.features).toEqual([]);
        expect(comparisonLocations(comparison)).toEqual([]);
        expect(comparisonBounds(comparison)).toBeNull();
        expect(evidenceMarkup(comparison, match)).toContain(
          "Coordinates unavailable for this feature.",
        );
      }
      const comparison = createConflationComparison(base, patch, candidate());
      comparison.features[0]!.geometry = { type: "Point", coordinates: [longitude, latitude] };
      expect(comparisonLocations(comparison).map((location) => location.role)).toEqual(["source"]);
      expect(comparisonBounds(comparison)).toEqual([-120.5, 46.5, -120.5, 46.5]);
      comparison.features[0]!.geometry = {
        type: "LineString",
        coordinates: [
          [0, 0],
          [longitude, latitude],
        ],
      };
      expect(comparisonLocations(comparison).map((location) => location.role)).toEqual(["source"]);
      expect(comparisonBounds(comparison)).toEqual([-120.5, 46.5, -120.5, 46.5]);
    },
  );

  it("omits a way with missing referenced geometry instead of drawing an invented segment", () => {
    const { base, patch } = fixture();
    const match = candidate("way", 22, 10);
    const comparison = createConflationComparison(base, patch, match);
    expect(comparison.features.map((feature) => feature.properties?.["role"])).toEqual(["target"]);
    expect(evidenceMarkup(comparison, match)).toContain(
      "Coordinates unavailable for this feature.",
    );
  });

  it("replaces the map and text together and does not relabel stale coordinates for another selection", () => {
    const { base, patch } = fixture();
    const first = candidate();
    const next = candidate("node", 102, 2);
    const firstComparison = createConflationComparison(base, patch, first);
    const nextComparison = createConflationComparison(base, patch, next);
    const store = createStore();
    store.set(conflationComparisonAtom, firstComparison);
    store.set(conflationComparisonAtom, nextComparison);
    expect(
      comparisonLocations(store.get(conflationComparisonAtom)).map((point) => point.entityId),
    ).toEqual([2, 102]);
    expect(comparisonForCandidate(firstComparison, next.id).features).toEqual([]);
    expect(evidenceMarkup(firstComparison, next)).not.toContain("-120.5000000°");
    const html = evidenceMarkup(nextComparison, next);
    expect(html).toContain("-120.4990000°");
    expect(html).toContain("-120.4980000°");
    expect(html).not.toContain("-120.5000000°");
    store.set(resetConflationReviewAtom);
    expect(comparisonLocations(store.get(conflationComparisonAtom))).toEqual([]);
    expect(comparisonBounds(store.get(conflationComparisonAtom))).toBeNull();
  });

  it("pairs distinct shapes with visible role and line-pattern labels", () => {
    const base = renderToStaticMarkup(createElement(ComparisonMarkerSymbol, { role: "target" }));
    const source = renderToStaticMarkup(createElement(ComparisonMarkerSymbol, { role: "source" }));
    expect(base).toContain("<circle");
    expect(source).toContain("<path");
    expect(source).not.toContain("<circle");
    const legend = renderToStaticMarkup(createElement(ConflationComparisonLegend));
    expect(legend).toContain('role="group" aria-label="Map comparison legend"');
    expect(legend).toContain("Base OSM: circle, solid line");
    expect(legend).toContain("Imported feature: diamond, dashed line");
    expect(legend).toContain("the diamond sits inside the circle");
    expect(comparisonCoordinate(-0)).toBe("0.0000000°");
  });
});
