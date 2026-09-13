import type { Feature, FeatureCollection, LineString, Point, Position } from "geojson";
import type { Osm, OsmConflationCandidateView } from "osmix";

export type ConflationComparisonRole = "source" | "target";
type ComparisonCandidate = Pick<
  OsmConflationCandidateView,
  "id" | "entityType" | "sourceId" | "targetId"
>;

export interface ConflationComparisonLocation {
  candidateId: string;
  entityId: number;
  role: ConflationComparisonRole;
  location: "Point" | "Start" | "End" | "Start and end";
  latitude: number;
  longitude: number;
}

function validPosition(position: Position | undefined): position is [number, number] {
  return (
    position !== undefined &&
    Number.isFinite(position[0]) &&
    position[0]! >= -180 &&
    position[0]! <= 180 &&
    Number.isFinite(position[1]) &&
    position[1]! >= -90 &&
    position[1]! <= 90
  );
}

/** Build map geometry once; the written coordinates use these same features. */
export function createConflationComparison(
  base: Osm,
  patch: Osm,
  candidate: ComparisonCandidate,
): FeatureCollection<Point | LineString> {
  const features: Feature<Point | LineString>[] = [];
  for (const role of ["target", "source"] as const) {
    const osm = role === "target" ? base : patch;
    const id = role === "target" ? candidate.targetId : candidate.sourceId;
    if (id == null) continue;
    let geometry: Point | LineString;
    if (candidate.entityType === "node") {
      const node = osm.nodes.getById(id);
      if (!node || !validPosition([node.lon, node.lat])) continue;
      geometry = { type: "Point", coordinates: [node.lon, node.lat] };
    } else {
      const way = osm.ways.getById(id);
      if (!way) continue;
      const coordinates = way.refs.map((ref) => osm.nodes.getNodeLonLat({ id: ref }) ?? undefined);
      // A partial line would invent a connection over missing geometry.
      if (coordinates.length < 2 || !coordinates.every(validPosition)) continue;
      geometry = { type: "LineString", coordinates };
    }
    features.push({
      type: "Feature",
      id: `${candidate.id}:${role}`,
      geometry,
      properties: {
        candidateId: candidate.id,
        entityId: id,
        entityType: candidate.entityType,
        role,
      },
    });
  }
  return { type: "FeatureCollection", features };
}

/** Select only this match's geometry, so stale collections cannot label another match. */
export function comparisonForCandidate(comparison: FeatureCollection, candidateId: string) {
  return {
    type: "FeatureCollection",
    features: comparison.features.filter(
      (feature) => feature.properties?.["candidateId"] === candidateId,
    ),
  } satisfies FeatureCollection;
}

/** Actual point or ordered way endpoints; no inferred centroid is presented as a location. */
export function comparisonLocations(comparison: FeatureCollection): ConflationComparisonLocation[] {
  const result: ConflationComparisonLocation[] = [];
  for (const feature of comparison.features) {
    const role: unknown = feature.properties?.["role"];
    const entityId: unknown = feature.properties?.["entityId"];
    const candidateId: unknown = feature.properties?.["candidateId"];
    if (
      (role !== "source" && role !== "target") ||
      typeof entityId !== "number" ||
      typeof candidateId !== "string"
    )
      continue;
    const add = (
      position: Position | undefined,
      location: ConflationComparisonLocation["location"],
    ) => {
      if (!validPosition(position)) return;
      result.push({
        role,
        entityId,
        candidateId,
        location,
        longitude: position[0],
        latitude: position[1],
      });
    };
    if (feature.geometry.type === "Point") {
      add(feature.geometry.coordinates, "Point");
    } else if (feature.geometry.type === "LineString") {
      if (
        feature.geometry.coordinates.length < 2 ||
        !feature.geometry.coordinates.every(validPosition)
      )
        continue;
      const first = feature.geometry.coordinates[0];
      const last = feature.geometry.coordinates.at(-1);
      if (
        validPosition(first) &&
        validPosition(last) &&
        first[0] === last[0] &&
        first[1] === last[1]
      ) {
        add(first, "Start and end");
      } else {
        add(first, "Start");
        add(last, "End");
      }
    }
  }
  return result;
}

/** Bounds cover all compared geometry, including bends between way endpoints. */
export function comparisonBounds(
  comparison: FeatureCollection,
): [number, number, number, number] | null {
  const positions = comparison.features
    .flatMap((feature) => {
      if (feature.geometry.type === "Point") return [feature.geometry.coordinates];
      if (
        feature.geometry.type === "LineString" &&
        feature.geometry.coordinates.length >= 2 &&
        feature.geometry.coordinates.every(validPosition)
      )
        return feature.geometry.coordinates;
      return [];
    })
    .filter(validPosition);
  if (positions.length === 0) return null;
  return positions.reduce<[number, number, number, number]>(
    (bounds, [longitude, latitude]) => [
      Math.min(bounds[0], longitude),
      Math.min(bounds[1], latitude),
      Math.max(bounds[2], longitude),
      Math.max(bounds[3], latitude),
    ],
    [Infinity, Infinity, -Infinity, -Infinity],
  );
}

export function comparisonCoordinate(value: number) {
  return `${Object.is(value, -0) ? "0.0000000" : value.toFixed(7)}°`;
}
