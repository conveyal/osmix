import { getFixtureFileReadStream, PBFs } from "@osmix/test-utils";
import { fromPbf, Osm, type LonLat, type OsmTags } from "osmix";
import { beforeAll, describe, expect, it, vi } from "vitest";

import { MapCamera, type MapViewport, worldToLonLat } from "../src/camera.ts";
import {
  collectMapLabelCandidates,
  layoutMapLabels,
  resolveLabelMetadata,
  truncateLabelText,
  type LabelTextMeasurer,
  type MapLabelCandidate,
} from "../src/map-labels.ts";

function candidate(overrides: Partial<MapLabelCandidate> = {}): MapLabelCandidate {
  return {
    anchor: { x: 40, y: 20 },
    kind: "road",
    placement: "center",
    priority: 800,
    stableKey: "candidate",
    text: "Main St",
    visibleLength: 10,
    ...overrides,
  };
}

const simpleMeasure: LabelTextMeasurer = (text, maxWidth) => {
  const graphemes = [...new Intl.Segmenter(undefined, { granularity: "grapheme" }).segment(text)];
  return truncateLabelText(
    text,
    graphemes.map(() => 1),
    maxWidth,
  );
};

function coordinateAt(camera: MapCamera, viewport: MapViewport, x: number, y: number): LonLat {
  const origin = camera.origin(viewport);
  return worldToLonLat({
    x: (origin.x + x) / camera.worldSize,
    y: (origin.y + y) / camera.worldSize,
  });
}

function addWayAtScreen(
  osm: Osm,
  camera: MapCamera,
  viewport: MapViewport,
  id: number,
  points: [number, number][],
  tags: OsmTags,
): void {
  const refs: number[] = [];
  for (const [index, point] of points.entries()) {
    if (index === points.length - 1 && point[0] === points[0]?.[0] && point[1] === points[0]?.[1]) {
      refs.push(refs[0]!);
      continue;
    }
    const nodeId = id * 100 + index;
    const [lon, lat] = coordinateAt(camera, viewport, point[0], point[1]);
    osm.nodes.addNode({ id: nodeId, lon, lat });
    refs.push(nodeId);
  }
  osm.ways.addWay({ id, refs, tags });
}

describe("resolveLabelMetadata", () => {
  it("applies zoom thresholds to places and road classes", () => {
    expect(resolveLabelMetadata({ place: "city", name: "City" }, "Point", 3)).toBeNull();
    expect(resolveLabelMetadata({ place: "city", name: "City" }, "Point", 4)).toMatchObject({
      kind: "place",
      text: "City",
    });
    expect(resolveLabelMetadata({ highway: "primary", name: "A1" }, "LineString", 8)).toBeNull();
    expect(resolveLabelMetadata({ highway: "primary", name: "A1" }, "LineString", 9)).toMatchObject(
      {
        kind: "road",
      },
    );
    expect(
      resolveLabelMetadata({ highway: "residential", name: "Main St" }, "LineString", 11),
    ).toBeNull();
    expect(
      resolveLabelMetadata({ highway: "residential", name: "Main St" }, "LineString", 12),
    ).toMatchObject({ kind: "road" });
    expect(
      resolveLabelMetadata({ highway: "footway", name: "Promenade" }, "LineString", 14),
    ).toBeNull();
    expect(
      resolveLabelMetadata({ highway: "footway", name: "Promenade" }, "LineString", 15),
    ).toMatchObject({
      kind: "road",
    });
  });

  it("applies water, site, and semantic POI thresholds", () => {
    expect(resolveLabelMetadata({ natural: "water", name: "Lake" }, "Polygon", 8)).toMatchObject({
      kind: "water",
    });
    expect(resolveLabelMetadata({ waterway: "river", name: "River" }, "LineString", 9)).toBeNull();
    expect(
      resolveLabelMetadata({ waterway: "river", name: "River" }, "LineString", 10),
    ).toMatchObject({
      kind: "water",
    });
    expect(resolveLabelMetadata({ leisure: "park", name: "Park" }, "Polygon", 12)).toMatchObject({
      kind: "site",
    });
    expect(
      resolveLabelMetadata({ amenity: "hospital", name: "Clinic" }, "Point", 14),
    ).toMatchObject({
      kind: "poi",
    });
    expect(resolveLabelMetadata({ amenity: "cafe", name: "Cafe" }, "Point", 14)).toBeNull();
    expect(resolveLabelMetadata({ amenity: "cafe", name: "Cafe" }, "Point", 15)).toMatchObject({
      kind: "poi",
    });
  });

  it("prefers local names, then English, then road references", () => {
    expect(
      resolveLabelMetadata(
        { highway: "primary", name: "Route locale", "name:en": "English Route", ref: "A1" },
        "LineString",
        10,
      ),
    ).toMatchObject({ text: "Route locale" });
    expect(
      resolveLabelMetadata(
        { highway: "primary", "name:en": "English Route", ref: "A1" },
        "LineString",
        10,
      ),
    ).toMatchObject({ text: "English Route" });
    expect(resolveLabelMetadata({ highway: "primary", ref: "A1" }, "LineString", 10)).toMatchObject(
      {
        text: "A1",
      },
    );
  });

  it("omits buildings, addresses, unnamed, and unclassified geometry", () => {
    expect(resolveLabelMetadata({ building: "yes", name: "Tower" }, "Polygon", 16)).toBeNull();
    expect(resolveLabelMetadata({ "addr:housenumber": "12" }, "Point", 16)).toBeNull();
    expect(resolveLabelMetadata({ highway: "primary" }, "LineString", 16)).toBeNull();
    expect(resolveLabelMetadata({ name: "Unknown" }, "Point", 16)).toBeNull();
  });
});

describe("label text and collision layout", () => {
  it("truncates by grapheme widths rather than JavaScript string length", () => {
    expect(truncateLabelText("東京é", [2, 2, 1], 5)).toEqual({ text: "東京é", width: 5 });
    expect(truncateLabelText("東京é", [2, 2, 1], 4)).toEqual({ text: "東…", width: 3 });
  });

  it("keeps higher-priority labels when padded collision boxes overlap", () => {
    const labels = layoutMapLabels(
      [
        candidate({ kind: "poi", priority: 600, stableKey: "poi", text: "Cafe" }),
        candidate({ kind: "place", priority: 1_000, stableKey: "place", text: "Monaco" }),
      ],
      { width: 80, height: 24 },
      simpleMeasure,
    );

    expect(labels).toHaveLength(1);
    expect(labels[0]).toMatchObject({ kind: "place", text: "Monaco" });
  });

  it("places point labels to the right and falls back to the left", () => {
    const labels = layoutMapLabels(
      [
        candidate({ anchor: { x: 35, y: 20 }, kind: "place", priority: 1_000, text: "Town" }),
        candidate({
          anchor: { x: 30, y: 20 },
          kind: "poi",
          placement: "point",
          priority: 600,
          text: "Cafe",
        }),
      ],
      { width: 80, height: 24 },
      simpleMeasure,
    );

    expect(labels).toHaveLength(2);
    expect(labels.find((label) => label.kind === "poi")?.x).toBe(24);
  });

  it("caps labels at 24 columns and keeps backplates within the viewport", () => {
    const labels = layoutMapLabels(
      [
        candidate({
          anchor: { x: 40, y: 20 },
          text: "A very long avenue name that must be shortened",
        }),
      ],
      { width: 80, height: 24 },
      simpleMeasure,
    );

    expect(labels[0]?.width).toBeLessThanOrEqual(24);
    expect(labels[0]?.text.endsWith("…")).toBe(true);
    expect(labels[0]!.backplateX).toBeGreaterThanOrEqual(0);
    expect(labels[0]!.backplateX + labels[0]!.backplateWidth).toBeLessThanOrEqual(80);
  });
});

describe("collectMapLabelCandidates", () => {
  it("classifies ways and relations before retrieving their geometry", () => {
    const viewport = { width: 100, height: 60 };
    const camera = new MapCamera(0.5, 0.5, 10);
    const osm = new Osm();
    addWayAtScreen(
      osm,
      camera,
      viewport,
      1,
      [
        [20, 15],
        [80, 15],
        [80, 45],
        [20, 45],
        [20, 15],
      ],
      { name: "Unclassified area" },
    );
    osm.relations.addRelation({
      id: 2,
      members: [{ type: "way", ref: 1, role: "outer" }],
      tags: { type: "multipolygon", name: "Unclassified relation" },
    });
    osm.buildIndexes();
    osm.buildSpatialIndexes();
    const getWayCoordinates = vi.spyOn(osm.ways, "getCoordinates");
    const getRelationGeometry = vi.spyOn(osm.relations, "getRelationGeometry");

    expect(collectMapLabelCandidates(osm, camera, viewport)).toEqual([]);
    expect(getWayCoordinates).not.toHaveBeenCalled();
    expect(getRelationGeometry).not.toHaveBeenCalled();
  });

  it("accepts worker-owned way and relation search providers", () => {
    const viewport = { width: 100, height: 60 };
    const camera = new MapCamera(0.5, 0.5, 10);
    const osm = new Osm();
    addWayAtScreen(
      osm,
      camera,
      viewport,
      1,
      [
        [10, 20],
        [90, 20],
      ],
      { highway: "primary", name: "Indexed Road" },
    );
    osm.buildIndexes();
    osm.buildSpatialIndexes();
    const osmWaySearch = vi.spyOn(osm.ways, "intersects");
    const osmRelationSearch = vi.spyOn(osm.relations, "intersects");

    const candidates = collectMapLabelCandidates(osm, camera, viewport, {
      relations: { intersects: () => [] },
      ways: { intersects: () => [0] },
    });

    expect(candidates.map((candidate) => candidate.text)).toEqual(["Indexed Road"]);
    expect(osmWaySearch).not.toHaveBeenCalled();
    expect(osmRelationSearch).not.toHaveBeenCalled();
  });

  it("deduplicates named lines by retaining the longest visible geometry", () => {
    const viewport = { width: 100, height: 60 };
    const camera = new MapCamera(0.5, 0.5, 10);
    const osm = new Osm();
    addWayAtScreen(
      osm,
      camera,
      viewport,
      1,
      [
        [10, 20],
        [90, 20],
      ],
      {
        highway: "primary",
        name: "Main Road",
      },
    );
    addWayAtScreen(
      osm,
      camera,
      viewport,
      2,
      [
        [20, 40],
        [40, 40],
      ],
      {
        highway: "primary",
        name: "Main Road",
      },
    );
    osm.buildIndexes();
    osm.buildSpatialIndexes();

    const candidates = collectMapLabelCandidates(osm, camera, viewport);
    expect(candidates).toHaveLength(1);
    expect(candidates[0]?.text).toBe("Main Road");
    expect(candidates[0]?.visibleLength).toBeCloseTo(80, 1);
    expect(candidates[0]?.anchor.x).toBeCloseTo(50, 1);
  });

  it("suppresses a named area member when its relation supplies the label", () => {
    const viewport = { width: 100, height: 60 };
    const camera = new MapCamera(0.5, 0.5, 10);
    const osm = new Osm();
    addWayAtScreen(
      osm,
      camera,
      viewport,
      1,
      [
        [20, 15],
        [80, 15],
        [80, 45],
        [20, 45],
        [20, 15],
      ],
      {
        natural: "water",
        name: "Relation Lake",
      },
    );
    osm.relations.addRelation({
      id: 2,
      members: [{ type: "way", ref: 1, role: "outer" }],
      tags: { type: "multipolygon", natural: "water", name: "Relation Lake" },
    });
    osm.buildIndexes();
    osm.buildSpatialIndexes();

    const candidates = collectMapLabelCandidates(osm, camera, viewport);
    expect(candidates).toHaveLength(1);
    expect(candidates[0]?.stableKey).toBe("relation:2:polygon");
  });
});

describe("Monaco label detail", () => {
  let osm: Osm;

  beforeAll(async () => {
    osm = await fromPbf(getFixtureFileReadStream(PBFs["monaco"]!.url));
  });

  it("shows major road labels at fit zoom and progressively richer close detail", () => {
    const viewport = { width: 100, height: 62 };
    const fitted = MapCamera.fitBounds(osm.bbox(), viewport);
    const overview = collectMapLabelCandidates(osm, fitted, viewport);
    const detailed = collectMapLabelCandidates(
      osm,
      new MapCamera(fitted.centerX, fitted.centerY, 11),
      viewport,
    );
    const close = collectMapLabelCandidates(
      osm,
      new MapCamera(fitted.centerX, fitted.centerY, 15),
      viewport,
    );

    expect(fitted.zoom).toBe(10);
    expect(overview.some((label) => label.kind === "road")).toBe(true);
    expect(detailed.some((label) => label.priority === 840)).toBe(true);
    expect(close.some((label) => label.kind === "poi" || label.priority <= 820)).toBe(true);
  });

  it("lays out fixture labels without overlap or status-row intrusion", () => {
    const pixelViewport = { width: 100, height: 62 };
    const camera = MapCamera.fitBounds(osm.bbox(), pixelViewport);
    const candidates = collectMapLabelCandidates(osm, camera, pixelViewport);
    const labels = layoutMapLabels(candidates, { width: 100, height: 31 }, simpleMeasure);

    expect(labels.length).toBeGreaterThan(0);
    for (const [index, label] of labels.entries()) {
      expect(label.y).toBeLessThan(31);
      const a = {
        left: label.backplateX - 1,
        right: label.backplateX + label.backplateWidth,
        top: label.y - 1,
        bottom: label.y + 1,
      };
      for (const other of labels.slice(index + 1)) {
        const b = {
          left: other.backplateX - 1,
          right: other.backplateX + other.backplateWidth,
          top: other.y - 1,
          bottom: other.y + 1,
        };
        const overlaps =
          a.left <= b.right && a.right >= b.left && a.top <= b.bottom && a.bottom >= b.top;
        expect(overlaps).toBe(false);
      }
    }
  });
});
