import type { Osm } from "@osmix/core";
import {
  type At,
  type FeatureSpec,
  type GeometrySpec,
  type LonLat,
  MONACO_MERGE_SCENARIOS,
  type MergeScenario,
} from "@osmix/test-utils/monaco-merge-scenarios";
import type { Feature, FeatureCollection, Geometry, Position } from "geojson";

const EARTH_RADIUS_METERS = 6_371_008.8;
const RAD = Math.PI / 180;

/** Seven decimals: the precision nodes are stored at (1e7 fixed point). */
function round7(value: number): number {
  return Math.round(value * 1e7) / 1e7;
}

function roundPosition([lon, lat]: LonLat): LonLat {
  return [round7(lon), round7(lat)];
}

/** The point `meters` from `from` on an initial `bearing` (degrees clockwise from north). */
function destination([lon, lat]: LonLat, meters: number, bearing: number): LonLat {
  const angular = meters / EARTH_RADIUS_METERS;
  const theta = bearing * RAD;
  const phi1 = lat * RAD;
  const lambda1 = lon * RAD;
  const phi2 = Math.asin(
    Math.sin(phi1) * Math.cos(angular) + Math.cos(phi1) * Math.sin(angular) * Math.cos(theta),
  );
  const lambda2 =
    lambda1 +
    Math.atan2(
      Math.sin(theta) * Math.sin(angular) * Math.cos(phi1),
      Math.cos(angular) - Math.sin(phi1) * Math.sin(phi2),
    );
  return [lambda2 / RAD, phi2 / RAD];
}

/** Initial bearing from `a` to `b`, in degrees clockwise from north. */
function bearingBetween([lon1, lat1]: LonLat, [lon2, lat2]: LonLat): number {
  const phi1 = lat1 * RAD;
  const phi2 = lat2 * RAD;
  const dLambda = (lon2 - lon1) * RAD;
  const y = Math.sin(dLambda) * Math.cos(phi2);
  const x = Math.cos(phi1) * Math.sin(phi2) - Math.sin(phi1) * Math.cos(phi2) * Math.cos(dLambda);
  return (Math.atan2(y, x) / RAD + 360) % 360;
}

function distanceMeters([lon1, lat1]: LonLat, [lon2, lat2]: LonLat): number {
  const dPhi = (lat2 - lat1) * RAD;
  const dLambda = (lon2 - lon1) * RAD;
  const s =
    Math.sin(dPhi / 2) ** 2 +
    Math.cos(lat1 * RAD) * Math.cos(lat2 * RAD) * Math.sin(dLambda / 2) ** 2;
  return 2 * EARTH_RADIUS_METERS * Math.asin(Math.sqrt(s));
}

function interpolate(a: LonLat, b: LonLat, fraction: number): LonLat {
  return [a[0] + (b[0] - a[0]) * fraction, a[1] + (b[1] - a[1]) * fraction];
}

/** Resolves scenario geometry against the Monaco base, failing loudly on a bad anchor. */
class Anchors {
  private readonly base: Osm;
  private readonly scenario: MergeScenario;
  /** Coordinates of the features built so far, for `vertexOf`. */
  private readonly built: ReadonlyMap<number, LonLat[]>;

  constructor(base: Osm, scenario: MergeScenario, built: ReadonlyMap<number, LonLat[]>) {
    this.base = base;
    this.scenario = scenario;
    this.built = built;
  }

  node(nodeId: number): LonLat {
    const node = this.base.nodes.getById(nodeId);
    if (!node) throw Error(`${this.scenario.id}: Monaco has no node ${nodeId}`);
    return [node.lon, node.lat];
  }

  wayCoords(wayId: number): LonLat[] {
    const way = this.base.ways.getById(wayId);
    if (!way) throw Error(`${this.scenario.id}: Monaco has no way ${wayId}`);
    return way.refs.map((ref) => this.node(ref));
  }

  at(at: At): LonLat {
    if ("lonLat" in at) return at.lonLat;
    if ("between" in at) {
      const a = this.node(at.between[0]);
      const b = this.node(at.between[1]);
      const point = interpolate(a, b, at.fraction);
      if (!at.sideMeters) return point;
      return destination(point, at.sideMeters, (bearingBetween(a, b) + 90) % 360);
    }
    if ("vertexOf" in at) {
      const vertex = this.built.get(at.vertexOf)?.[at.index];
      if (!vertex)
        throw Error(`${this.scenario.id}: no vertex ${at.index} of feature ${at.vertexOf}`);
      return vertex;
    }
    if ("offset" in at) return destination(this.at(at.offset), at.meters, at.bearing);
    const anchor = this.node(at.node);
    return "meters" in at ? destination(anchor, at.meters, at.bearing) : anchor;
  }

  /** The centre of a `cross` or `square`, and the crossed segment's bearing. */
  segmentPoint(wayId: number, segment: number, fraction: number): [LonLat, number] {
    const coords = this.wayCoords(wayId);
    const a = coords[segment];
    const b = coords[segment + 1];
    if (!a || !b) throw Error(`${this.scenario.id}: way ${wayId} has no segment ${segment}`);
    return [interpolate(a, b, fraction), bearingBetween(a, b)];
  }
}

function lineCoords(
  anchors: Anchors,
  geometry: Exclude<GeometrySpec, { type: "point" }>,
): LonLat[] {
  switch (geometry.type) {
    case "path":
      return geometry.path.map((at) => anchors.at(at));
    case "copy": {
      const source = anchors.wayCoords(geometry.way);
      const coords = geometry.reverse ? source.toReversed() : source;
      const first = coords[0]!;
      const last = coords.at(-1)!;
      const side = (bearingBetween(first, last) + 90) % 360;
      const moved = coords.map((c) => destination(c, geometry.sideMeters, side));
      if (!geometry.zigzagMeters) return moved;
      // A vertex every 2 m, alternately to each side: longer, but within the match radius.
      const zigzag: LonLat[] = [moved[0]!];
      let flip = 1;
      for (let i = 1; i < moved.length; i++) {
        const a = moved[i - 1]!;
        const b = moved[i]!;
        const steps = Math.floor(distanceMeters(a, b) / 2);
        const segmentSide = (bearingBetween(a, b) + 90) % 360;
        for (let step = 1; step < steps; step++) {
          const along = interpolate(a, b, step / steps);
          zigzag.push(destination(along, geometry.zigzagMeters * flip, segmentSide));
          flip = -flip;
        }
        zigzag.push(b);
      }
      return zigzag;
    }
    case "spur": {
      const start = destination(anchors.node(geometry.node), geometry.gapMeters, geometry.bearing);
      return [start, destination(start, geometry.lengthMeters, geometry.bearing)];
    }
    case "extend": {
      const coords = anchors.wayCoords(geometry.way);
      const [end, inner] =
        geometry.end === "start" ? [coords[0]!, coords[1]!] : [coords.at(-1)!, coords.at(-2)!];
      const outward = bearingBetween(inner, end);
      const start = destination(end, geometry.gapMeters, outward);
      return [start, destination(start, geometry.lengthMeters, outward)];
    }
    case "cross": {
      const [centre, bearing] = anchors.segmentPoint(
        geometry.way,
        geometry.segment,
        geometry.fraction,
      );
      const side = (bearing + 90) % 360;
      return [
        destination(centre, geometry.halfLengthMeters, (side + 180) % 360),
        destination(centre, geometry.halfLengthMeters, side),
      ];
    }
    case "square": {
      const [centre, bearing] = anchors.segmentPoint(
        geometry.way,
        geometry.segment,
        geometry.fraction,
      );
      const half = geometry.sizeMeters / 2;
      const corner = (along: number, across: number) =>
        destination(
          destination(centre, half * along, bearing),
          half * across,
          (bearing + 90) % 360,
        );
      const ring = [corner(-1, -1), corner(1, -1), corner(1, 1), corner(-1, 1)];
      return [...ring, ring[0]!];
    }
  }
}

/** The feature's rounded coordinates (one for a Point, a closed ring for a square). */
function featureCoords(anchors: Anchors, spec: FeatureSpec): LonLat[] {
  const { geometry } = spec;
  const coords =
    geometry.type === "point" ? [anchors.at(geometry.at)] : lineCoords(anchors, geometry);
  return coords.map(roundPosition);
}

function featureGeometry(spec: FeatureSpec, coords: LonLat[]): Geometry {
  const positions = coords.map((c): Position => [c[0], c[1]]);
  if (spec.geometry.type === "point") return { type: "Point", coordinates: positions[0]! };
  if (spec.geometry.type === "square") return { type: "Polygon", coordinates: [positions] };
  return { type: "LineString", coordinates: positions };
}

/**
 * The patch for `scenarios` against the Monaco `base`: one feature per spec, in scenario
 * order, with coordinates rounded to the 7 decimals nodes are stored at.
 */
export function buildMonacoMergePatch(
  base: Osm,
  scenarios: readonly MergeScenario[] = MONACO_MERGE_SCENARIOS,
): FeatureCollection {
  const built = new Map<number, LonLat[]>();
  const features: Feature[] = [];
  for (const scenario of scenarios) {
    const anchors = new Anchors(base, scenario, built);
    for (const spec of scenario.features) {
      if (built.has(spec.id)) throw Error(`${scenario.id}: duplicate feature id ${spec.id}`);
      const coords = featureCoords(anchors, spec);
      built.set(spec.id, coords);
      features.push({
        type: "Feature",
        id: spec.id,
        properties: { ...spec.tags },
        geometry: featureGeometry(spec, coords),
      });
    }
  }
  return { type: "FeatureCollection", features };
}
