/**
 * Merge scenarios for `fixtures/monaco-merge-patch.geojson`: a small GeoJSON patch against
 * `fixtures/monaco.pbf` that drives each user-visible merge outcome on real data. This module is
 * the source of truth. `packages/osmix/scripts/generate-monaco-merge-patch.ts` turns it into
 * the GeoJSON (anchoring each geometry to a Monaco entity), and the tests read the
 * expectations from it. Data only: no workspace imports, so any package or app can use it.
 */

/** The fixture file name, for `getFixturePath`. */
export const MONACO_MERGE_PATCH = "monaco-merge-patch.geojson";

/**
 * Matching options the fixture is written for: the Merge app's default copy keys, plus a
 * non-routing key (`opening_hours`, `surface`) so automatic copies are reachable, and a
 * protected key (`level`) so protected-only differences are. Connect network and removal
 * review are on.
 */
export const MONACO_MERGE_CONFLATION = {
  propertyKeys: [
    "barrier",
    "crossing",
    "kerb",
    "level",
    "opening_hours",
    "surface",
    "tactile_paving",
  ],
  attachNetwork: true,
  allowWayRemoval: true,
  maxDistanceMeters: 1,
  automatic: "high-confidence",
} as const;

/**
 * Branches the fixture cannot reach: GeoJSON cannot make a relation that references a base
 * entity, and Monaco's only relations are turn restrictions. In-code unit tests cover these.
 */
export const MONACO_MERGE_OUT_OF_SCOPE = [
  "relation-member review and restriction blocks in matching",
  "way-removal-relation-member",
  "via-node and via-way restriction handling in exact reconciliation and intersections",
] as const;

/** `[lon, lat]` in degrees. */
export type LonLat = readonly [number, number];

/**
 * A position: exactly on a base node, offset from one, `fraction` of the way from one base node
 * to another (moved `sideMeters` to the right of that direction), a vertex of an earlier patch feature (so two lines share it), an offset from
 * another position, or absolute.
 */
export type At =
  | { node: number }
  | { node: number; meters: number; bearing: number }
  | { between: readonly [number, number]; fraction: number; sideMeters?: number }
  | { vertexOf: number; index: number }
  | { offset: At; meters: number; bearing: number }
  | { lonLat: LonLat };

/** Geometry for one patch feature, resolved against Monaco by the generator. */
export type GeometrySpec =
  | { type: "point"; at: At }
  /** A line through explicit positions. */
  | { type: "path"; path: At[] }
  /**
   * A copy of a base way's coordinates, moved `sideMeters` to the right of its overall
   * direction. `zigzagMeters` inserts a vertex every 2 m, alternately that far to each side,
   * so the copy stays within the match radius but is measurably longer.
   */
  | { type: "copy"; way: number; sideMeters: number; reverse?: boolean; zigzagMeters?: number }
  /** A straight line starting `gapMeters` from `node` and running `lengthMeters` on `bearing`. */
  | { type: "spur"; node: number; gapMeters: number; bearing: number; lengthMeters: number }
  /** A line starting `gapMeters` past a way's end, continuing its end segment's direction. */
  | { type: "extend"; way: number; end: "start" | "end"; gapMeters: number; lengthMeters: number }
  /**
   * A line crossing a base way at right angles, centred `fraction` along the segment that
   * starts at vertex `segment`, reaching `halfLengthMeters` to each side.
   */
  | { type: "cross"; way: number; segment: number; fraction: number; halfLengthMeters: number }
  /** A closed square polygon of side `sizeMeters`, centred like `cross`. */
  | { type: "square"; way: number; segment: number; fraction: number; sizeMeters: number };

/** One patch feature. Points come before the lines that reuse their coordinates. */
export interface FeatureSpec {
  id: number;
  geometry: GeometrySpec;
  tags: Record<string, string>;
}

/** The merge runs the tests make: automatic actions only, or with the scenarios' decisions. */
export type MergeRun = "automatic" | "reviewed";

/**
 * What the merged result should hold for a feature. Direct, identity and crossing
 * outcomes are the same in both runs; matching outcomes can name the `runs` they apply
 * to (default: both).
 */
export type StageExpectation = { runs?: MergeRun[] } & (
  | { kind: "created"; feature: number }
  | { kind: "replaced"; feature: number }
  | { kind: "refs-cleaned"; feature: number; refs: number }
  | {
      kind: "node-reconciled";
      feature: number;
      baseNode: number;
      mergedTags: Record<string, string>;
    }
  | { kind: "node-kept"; feature: number }
  | { kind: "way-reconciled"; feature: number; baseWay: number; filledTags: Record<string, string> }
  | { kind: "way-kept"; feature: number }
  | { kind: "crossing-added"; feature: number; crossedWay: number }
  | { kind: "vertex-spliced"; feature: number; crossedWay: number }
  | { kind: "not-connected"; feature: number; crossedWay: number }
  /** Matching copied `tags` onto a base entity. */
  | {
      kind: "tags-copied";
      baseEntity: { type: "node" | "way"; id: number };
      tags: Record<string, string>;
    }
  /** Matching left a base entity's `tags` as they were. */
  | { kind: "tags-unchanged"; baseEntity: { type: "node" | "way"; id: number }; keys: string[] }
  /** Connect network made vertex `index` of a patch way use `baseNode`. */
  | { kind: "attached"; feature: number; index: number; baseNode: number }
  /** Vertex `index` of a patch way is still its own node. */
  | { kind: "not-attached"; feature: number; index: number }
  /**
   * The imported way is gone and no way uses its original vertices: removal drops the nodes it
   * leaves unused, and a connection drops the vertex it replaced.
   */
  | { kind: "way-removed"; feature: number }
);

export type CandidateStatus = "automatic" | "review" | "blocked" | "unmatched";

/** One expected matching candidate, found by its source and target. */
export interface CandidateExpectation {
  entityType: "node" | "way";
  /** A feature ID, or `{ vertexOf, index }` for an automatically numbered line vertex. */
  source: number | { vertexOf: number; index: number };
  target: number | null;
  status: CandidateStatus;
  /** Every reason on the candidate, across its actions. */
  reasons: string[];
  /** Per-action statuses worth pinning: copy tags, connect network, remove imported way. */
  actions?: { copy?: CandidateStatus; attach?: CandidateStatus; remove?: CandidateStatus };
  /** The decision to take in the reviewed run; omitted means no decision. */
  decision?: { action: "accept" | "reject"; removeWay?: boolean };
}

/** One scenario: a few features in their own part of Monaco, and what should happen. */
export interface MergeScenario {
  id: string;
  /** The plan phase the scenario exercises (`exact` is the identity phase). */
  stage: "direct" | "exact" | "matching" | "removal" | "intersection";
  description: string;
  features: FeatureSpec[];
  stages: StageExpectation[];
  candidates: CandidateExpectation[];
}

/**
 * Explicit feature IDs: −(1,000,000 + scenario number × 100 + k), clear of the importer's
 * automatic vertex IDs (−1, −2, … per file). Only the replacement scenarios reuse Monaco IDs.
 */
export function scenarioFeatureId(scenarioNumber: number, k: number): number {
  return -(1_000_000 + scenarioNumber * 100 + k);
}

const id = scenarioFeatureId;

const footway = { highway: "footway" };

export const MONACO_MERGE_SCENARIOS: MergeScenario[] = [
  // ── Direct merge ────────────────────────────────────────────────────────────────────
  {
    id: "D1",
    stage: "direct",
    description: "A new standalone bench, away from everything, is created",
    features: [
      {
        id: id(1, 1),
        geometry: { type: "point", at: { node: 5932249019, meters: 40, bearing: 90 } },
        tags: { amenity: "bench" },
      },
    ],
    stages: [{ kind: "created", feature: id(1, 1) }],
    candidates: [],
  },
  {
    id: "D2",
    stage: "direct",
    description: "A Point with a Monaco node ID replaces that gate whole",
    features: [
      {
        id: 1685061943,
        geometry: { type: "point", at: { node: 1685061943 } },
        tags: { barrier: "gate", material: "metal" },
      },
    ],
    stages: [{ kind: "replaced", feature: 1685061943 }],
    candidates: [],
  },
  {
    id: "D3",
    stage: "direct",
    description: "A LineString with a Monaco way ID replaces that footway whole, reshaped",
    features: [
      {
        id: 628375511,
        geometry: {
          type: "path",
          path: [{ node: 5932249020 }, { node: 5932249019, meters: 5, bearing: 270 }],
        },
        tags: { ...footway, surface: "asphalt" },
      },
    ],
    stages: [{ kind: "replaced", feature: 628375511 }],
    candidates: [],
  },
  {
    id: "D4",
    stage: "direct",
    description: "A new footway that repeats a coordinate loses the repeated vertex",
    features: [
      {
        id: id(4, 1),
        geometry: {
          type: "path",
          path: [
            { node: 5932249019, meters: 60, bearing: 90 },
            { node: 5932249019, meters: 60, bearing: 90 },
            { node: 5932249019, meters: 72, bearing: 90 },
          ],
        },
        tags: footway,
      },
    ],
    stages: [{ kind: "refs-cleaned", feature: id(4, 1), refs: 2 }],
    candidates: [],
  },

  // ── Exact reconciliation ────────────────────────────────────────────────────────────
  {
    id: "X1",
    stage: "exact",
    description: "A Point exactly on a crossing, adding tactile paving, becomes that crossing",
    features: [
      {
        id: id(5, 1),
        geometry: { type: "point", at: { node: 21914341 } },
        tags: { highway: "crossing", crossing: "uncontrolled", tactile_paving: "yes" },
      },
    ],
    stages: [
      {
        kind: "node-reconciled",
        feature: id(5, 1),
        baseNode: 21914341,
        mergedTags: { tactile_paving: "yes", crossing: "uncontrolled" },
      },
    ],
    candidates: [],
  },
  {
    id: "X2",
    stage: "exact",
    description: "A Point exactly on a marked crossing, calling it uncontrolled, sets that value",
    features: [
      {
        id: id(6, 1),
        geometry: { type: "point", at: { node: 21918589 } },
        tags: { highway: "crossing", crossing: "uncontrolled" },
      },
    ],
    stages: [
      {
        kind: "node-reconciled",
        feature: id(6, 1),
        baseNode: 21918589,
        mergedTags: { highway: "crossing", crossing: "uncontrolled" },
      },
    ],
    candidates: [],
  },
  {
    id: "X3",
    stage: "exact",
    description: "A footway on exactly the same vertices, adding a name, becomes that footway",
    features: [
      {
        id: id(7, 1),
        geometry: { type: "copy", way: 177546833, sideMeters: 0 },
        tags: { ...footway, name: "Passage X3" },
      },
    ],
    stages: [
      {
        kind: "way-reconciled",
        feature: id(7, 1),
        baseWay: 177546833,
        filledTags: { name: "Passage X3" },
      },
    ],
    candidates: [],
  },
  {
    id: "X4",
    stage: "exact",
    description: "The same, but one-way: routing differs, so the way is kept",
    features: [
      {
        id: id(8, 1),
        geometry: { type: "copy", way: 159170520, sideMeters: 0 },
        tags: { ...footway, name: "Rue Princesse Florestine", oneway: "yes" },
      },
    ],
    stages: [{ kind: "way-kept", feature: id(8, 1) }],
    candidates: [],
  },
  {
    id: "X5",
    stage: "exact",
    description: "A gate exactly on an ungated footway node becomes that node, adding the gate",
    features: [
      {
        id: id(9, 1),
        geometry: { type: "point", at: { node: 1690205051 } },
        tags: { barrier: "gate" },
      },
    ],
    stages: [
      {
        kind: "node-reconciled",
        feature: id(9, 1),
        baseNode: 1690205051,
        mergedTags: { barrier: "gate" },
      },
    ],
    candidates: [],
  },

  // ── Matching: nodes ─────────────────────────────────────────────────────────────────
  {
    id: "M1",
    stage: "matching",
    description: "A footway continuing a viewpoint's path adds opening hours: copied automatically",
    features: [
      {
        id: id(10, 1),
        geometry: { type: "point", at: { node: 1031563224, meters: 0.5, bearing: 0 } },
        tags: { tourism: "viewpoint", opening_hours: "24/7" },
      },
      {
        id: id(10, 2),
        geometry: { type: "spur", node: 1031563224, gapMeters: 0.5, bearing: 0, lengthMeters: 12 },
        tags: footway,
      },
    ],
    stages: [
      {
        kind: "tags-copied",
        baseEntity: { type: "node", id: 1031563224 },
        tags: { opening_hours: "24/7" },
      },
      { kind: "attached", feature: id(10, 2), index: 0, baseNode: 1031563224 },
    ],
    candidates: [
      {
        entityType: "node",
        source: id(10, 1),
        target: 1031563224,
        status: "automatic",
        reasons: [],
        actions: { copy: "automatic", attach: "automatic" },
      },
    ],
  },
  {
    id: "M2",
    stage: "matching",
    description: "A raised kerb next to a lowered one: a routing tag, so review",
    features: [
      {
        id: id(11, 1),
        geometry: { type: "point", at: { node: 1736938084, meters: 0.5, bearing: 0 } },
        tags: { barrier: "kerb", kerb: "raised" },
      },
      {
        id: id(11, 2),
        geometry: { type: "spur", node: 1736938084, gapMeters: 0.5, bearing: 0, lengthMeters: 12 },
        tags: footway,
      },
    ],
    stages: [
      { kind: "tags-unchanged", baseEntity: { type: "node", id: 1736938084 }, keys: ["kerb"] },
    ],
    candidates: [
      {
        entityType: "node",
        source: id(11, 1),
        target: 1736938084,
        status: "review",
        reasons: ["node-context-conflict", "routing-family-conflict", "routing-property"],
        actions: { copy: "review", attach: "blocked" },
        decision: { action: "reject" },
      },
    ],
  },
  {
    id: "M3",
    stage: "matching",
    description: "A viewpoint on another level: only a protected tag differs, so blocked",
    features: [
      {
        id: id(12, 1),
        geometry: { type: "point", at: { node: 1790048390, meters: 0.5, bearing: 0 } },
        tags: { tourism: "viewpoint", level: "4" },
      },
      {
        id: id(12, 2),
        geometry: { type: "spur", node: 1790048390, gapMeters: 0.5, bearing: 0, lengthMeters: 12 },
        tags: footway,
      },
    ],
    stages: [
      { kind: "tags-unchanged", baseEntity: { type: "node", id: 1790048390 }, keys: ["level"] },
    ],
    candidates: [
      {
        entityType: "node",
        source: id(12, 1),
        target: 1790048390,
        status: "blocked",
        reasons: ["grade-conflict", "node-context-conflict", "protected-tag"],
        actions: { copy: "blocked", attach: "blocked" },
      },
    ],
  },
  {
    id: "M4",
    stage: "matching",
    description: "A viewpoint next to an information board: the tourism types conflict",
    features: [
      {
        id: id(13, 1),
        geometry: { type: "point", at: { node: 1784107009, meters: 0.5, bearing: 0 } },
        tags: { tourism: "viewpoint", tactile_paving: "yes" },
      },
      {
        id: id(13, 2),
        geometry: { type: "spur", node: 1784107009, gapMeters: 0.5, bearing: 0, lengthMeters: 12 },
        tags: footway,
      },
    ],
    stages: [
      {
        kind: "tags-unchanged",
        baseEntity: { type: "node", id: 1784107009 },
        keys: ["tactile_paving"],
      },
      { kind: "not-attached", feature: id(13, 2), index: 0 },
    ],
    candidates: [
      {
        entityType: "node",
        source: id(13, 1),
        target: 1784107009,
        status: "blocked",
        reasons: ["feature-type-conflict"],
        actions: { copy: "blocked", attach: "blocked" },
      },
    ],
  },
  {
    id: "M5",
    stage: "matching",
    description: "Tactile paving on a new footway with no base node within the radius",
    features: [
      {
        id: id(14, 1),
        geometry: { type: "point", at: { node: 5932249019, meters: 100, bearing: 90 } },
        tags: { tactile_paving: "yes" },
      },
      {
        id: id(14, 2),
        geometry: {
          type: "path",
          path: [
            { node: 5932249019, meters: 100, bearing: 90 },
            { node: 5932249019, meters: 112, bearing: 90 },
          ],
        },
        tags: footway,
      },
    ],
    stages: [{ kind: "not-attached", feature: id(14, 2), index: 0 }],
    candidates: [
      { entityType: "node", source: id(14, 1), target: null, status: "unmatched", reasons: [] },
    ],
  },
  {
    id: "M6",
    stage: "matching",
    description: "Tactile paving beside two base nodes 1 m apart: two targets, so review",
    features: [
      {
        id: id(15, 1),
        geometry: {
          type: "point",
          at: { between: [265023123, 9983257671], fraction: 0.5, sideMeters: 0.4 },
        },
        tags: { tactile_paving: "yes" },
      },
      {
        id: id(15, 2),
        geometry: {
          type: "path",
          path: [
            { between: [265023123, 9983257671], fraction: 0.5, sideMeters: 0.4 },
            { between: [265023123, 9983257671], fraction: 0.5, sideMeters: 12.4 },
          ],
        },
        tags: footway,
      },
    ],
    stages: [
      {
        kind: "tags-unchanged",
        baseEntity: { type: "node", id: 265023123 },
        keys: ["tactile_paving"],
      },
      {
        kind: "tags-unchanged",
        baseEntity: { type: "node", id: 9983257671 },
        keys: ["tactile_paving"],
      },
    ],
    candidates: [
      {
        entityType: "node",
        source: id(15, 1),
        target: 265023123,
        status: "review",
        reasons: ["multiple-targets"],
      },
      {
        entityType: "node",
        source: id(15, 1),
        target: 9983257671,
        status: "review",
        reasons: ["multiple-targets"],
      },
    ],
  },
  {
    id: "M7",
    stage: "matching",
    description: "Two new footways each put tactile paving 0.5 m from one base node",
    features: [
      {
        id: id(16, 1),
        geometry: { type: "point", at: { node: 5596424436, meters: 0.5, bearing: 60 } },
        tags: { tactile_paving: "yes" },
      },
      {
        id: id(16, 2),
        geometry: { type: "point", at: { node: 5596424436, meters: 0.5, bearing: 240 } },
        tags: { tactile_paving: "yes" },
      },
      {
        id: id(16, 3),
        geometry: { type: "spur", node: 5596424436, gapMeters: 0.5, bearing: 60, lengthMeters: 12 },
        tags: footway,
      },
      {
        id: id(16, 4),
        geometry: {
          type: "spur",
          node: 5596424436,
          gapMeters: 0.5,
          bearing: 240,
          lengthMeters: 12,
        },
        tags: footway,
      },
    ],
    stages: [
      {
        kind: "tags-unchanged",
        baseEntity: { type: "node", id: 5596424436 },
        keys: ["tactile_paving"],
      },
    ],
    candidates: [
      {
        entityType: "node",
        source: id(16, 1),
        target: 5596424436,
        status: "review",
        reasons: ["many-to-one"],
      },
      {
        entityType: "node",
        source: id(16, 2),
        target: 5596424436,
        status: "review",
        reasons: ["many-to-one"],
      },
    ],
  },

  // ── Matching: connect network ───────────────────────────────────────────────────────
  {
    id: "A1",
    stage: "matching",
    description: "A new footway continuing a dead end 0.5 m past it connects automatically",
    features: [
      {
        id: id(17, 1),
        geometry: {
          type: "extend",
          way: 691406127,
          end: "start",
          gapMeters: 0.5,
          lengthMeters: 15,
        },
        tags: footway,
      },
    ],
    stages: [{ kind: "attached", feature: id(17, 1), index: 0, baseNode: 6487733397 }],
    candidates: [
      {
        entityType: "node",
        source: { vertexOf: id(17, 1), index: 0 },
        target: 6487733397,
        status: "automatic",
        reasons: ["no-transferable-properties"],
        actions: { copy: "blocked", attach: "automatic" },
      },
    ],
  },
  {
    id: "A2",
    stage: "matching",
    description: "A ground-level footway ending 0.5 m from a footbridge node: grade conflict",
    features: [
      {
        id: id(18, 1),
        geometry: {
          type: "spur",
          node: 1696644402,
          gapMeters: 0.5,
          bearing: 270,
          lengthMeters: 12,
        },
        tags: footway,
      },
    ],
    stages: [{ kind: "not-attached", feature: id(18, 1), index: 0 }],
    candidates: [
      {
        entityType: "node",
        source: { vertexOf: id(18, 1), index: 0 },
        target: 1696644402,
        status: "blocked",
        reasons: ["grade-conflict", "no-transferable-properties"],
        actions: { attach: "blocked" },
      },
    ],
  },
  {
    id: "A3",
    stage: "matching",
    description: "A new residential street ending 0.5 m from a street node: drivable, so review",
    features: [
      {
        id: id(19, 1),
        geometry: { type: "spur", node: 25242841, gapMeters: 0.5, bearing: 270, lengthMeters: 20 },
        tags: { highway: "residential" },
      },
    ],
    stages: [{ kind: "not-attached", feature: id(19, 1), index: 0 }],
    candidates: [
      {
        entityType: "node",
        source: { vertexOf: id(19, 1), index: 0 },
        target: 25242841,
        status: "review",
        reasons: ["drivable-network", "no-transferable-properties"],
        actions: { attach: "review" },
        decision: { action: "reject" },
      },
    ],
  },

  {
    id: "A4",
    stage: "matching",
    description:
      "A one-way footway on exactly the vertices of a footway whose first node sits inside a " +
      "level=1 footway: connecting it would join grade-separated ways, so it is blocked",
    features: [
      {
        id: id(31, 1),
        geometry: { type: "copy", way: 217177146, sideMeters: 0 },
        tags: { ...footway, oneway: "yes" },
      },
    ],
    stages: [
      { kind: "way-kept", feature: id(31, 1) },
      { kind: "not-attached", feature: id(31, 1), index: 0 },
    ],
    candidates: [
      {
        entityType: "node",
        source: { vertexOf: id(31, 1), index: 0 },
        target: 5596346596,
        status: "blocked",
        reasons: ["grade-conflict", "no-transferable-properties"],
        actions: { attach: "blocked" },
      },
    ],
  },

  // ── Matching: ways ──────────────────────────────────────────────────────────────────
  {
    id: "W1",
    stage: "matching",
    description:
      "A footway 0.5 m beside a paved one, surfaced in asphalt: surface copied automatically",
    features: [
      {
        id: id(20, 1),
        geometry: { type: "copy", way: 4230116, sideMeters: 0.5 },
        tags: { ...footway, surface: "asphalt" },
      },
    ],
    stages: [
      {
        kind: "tags-copied",
        baseEntity: { type: "way", id: 4230116 },
        tags: { surface: "asphalt" },
      },
    ],
    candidates: [
      {
        entityType: "way",
        source: id(20, 1),
        target: 4230116,
        status: "automatic",
        reasons: ["way-removal-routing-conflict"],
        actions: { copy: "automatic", remove: "blocked" },
      },
    ],
  },
  {
    id: "W2",
    stage: "matching",
    description: "A zigzag copy of a footway: within the radius, but too long",
    features: [
      {
        id: id(21, 1),
        geometry: { type: "copy", way: 25722474, sideMeters: 0.3, zigzagMeters: 0.6 },
        tags: { ...footway, surface: "asphalt" },
      },
    ],
    stages: [
      { kind: "tags-unchanged", baseEntity: { type: "way", id: 25722474 }, keys: ["surface"] },
    ],
    candidates: [
      {
        entityType: "way",
        source: id(21, 1),
        target: 25722474,
        status: "blocked",
        reasons: [
          "length-mismatch",
          "way-removal-routing-conflict",
          "way-removal-topology-conflict",
          "way-removal-unsupported",
        ],
        actions: { copy: "blocked", remove: "blocked" },
      },
    ],
  },
  {
    id: "W3",
    stage: "matching",
    description: "A pedestrian line tracing a pedestrian area: area vs line",
    features: [
      {
        id: id(22, 1),
        geometry: { type: "copy", way: 334827799, sideMeters: 0.3 },
        tags: { highway: "pedestrian", surface: "asphalt" },
      },
    ],
    stages: [
      { kind: "tags-unchanged", baseEntity: { type: "way", id: 334827799 }, keys: ["surface"] },
    ],
    candidates: [
      {
        entityType: "way",
        source: id(22, 1),
        target: 334827799,
        status: "blocked",
        reasons: [
          "geometry-mismatch",
          "routing-family-conflict",
          "way-removal-routing-conflict",
          "way-removal-unsupported",
        ],
        actions: { copy: "blocked", remove: "blocked" },
      },
    ],
  },
  {
    id: "W4",
    stage: "matching",
    description: "A one-way copy of a two-way footway: routing conflict",
    features: [
      {
        id: id(23, 1),
        geometry: { type: "copy", way: 176284697, sideMeters: 0.3 },
        tags: { ...footway, name: "Rue de Vedel", oneway: "yes", surface: "asphalt" },
      },
    ],
    stages: [
      { kind: "tags-unchanged", baseEntity: { type: "way", id: 176284697 }, keys: ["surface"] },
    ],
    candidates: [
      {
        entityType: "way",
        source: id(23, 1),
        target: 176284697,
        status: "blocked",
        reasons: ["routing-family-conflict", "way-removal-routing-conflict"],
        actions: { copy: "blocked", remove: "blocked" },
      },
    ],
  },

  // ── Way removal ─────────────────────────────────────────────────────────────────────
  {
    id: "R1",
    stage: "removal",
    description: "An imported duplicate of a footway: removal is offered, and accepted",
    features: [
      {
        id: id(24, 1),
        geometry: { type: "copy", way: 626897283, sideMeters: 0.3 },
        tags: footway,
      },
    ],
    stages: [
      { kind: "way-kept", feature: id(24, 1), runs: ["automatic"] },
      { kind: "way-removed", feature: id(24, 1), runs: ["reviewed"] },
    ],
    candidates: [
      {
        entityType: "way",
        source: id(24, 1),
        target: 626897283,
        status: "review",
        reasons: ["no-transferable-properties"],
        actions: { copy: "blocked", remove: "review" },
        decision: { action: "accept", removeWay: true },
      },
    ],
  },
  {
    id: "R2",
    stage: "removal",
    description: "A duplicate with a new branch off its middle: the branch must connect first",
    features: [
      {
        id: id(25, 1),
        geometry: { type: "copy", way: 586508232, sideMeters: 0.3 },
        tags: footway,
      },
      {
        id: id(25, 2),
        geometry: {
          type: "path",
          path: [
            { vertexOf: id(25, 1), index: 1 },
            { offset: { vertexOf: id(25, 1), index: 1 }, meters: 15, bearing: 30 },
          ],
        },
        tags: footway,
      },
    ],
    stages: [{ kind: "way-kept", feature: id(25, 1) }],
    candidates: [
      {
        entityType: "way",
        source: id(25, 1),
        target: 586508232,
        status: "blocked",
        reasons: ["no-transferable-properties", "way-removal-connection-required"],
        actions: { remove: "blocked" },
      },
    ],
  },

  // ── Intersections ───────────────────────────────────────────────────────────────────
  {
    id: "I1",
    stage: "intersection",
    description: "A new footway crossing a footway mid-segment gets a crossing node",
    features: [
      {
        id: id(26, 1),
        geometry: { type: "cross", way: 687577837, segment: 1, fraction: 0.5, halfLengthMeters: 8 },
        tags: footway,
      },
    ],
    stages: [{ kind: "crossing-added", feature: id(26, 1), crossedWay: 687577837 }],
    candidates: [],
  },
  {
    id: "I2",
    stage: "intersection",
    description: "A new footway crossing 0.5 m from a footway vertex joins at that vertex",
    features: [
      {
        id: id(27, 1),
        geometry: { type: "cross", way: 92627440, segment: 0, fraction: 0.96, halfLengthMeters: 8 },
        tags: footway,
      },
    ],
    stages: [{ kind: "vertex-spliced", feature: id(27, 1), crossedWay: 92627440 }],
    candidates: [],
  },
  {
    id: "I3",
    stage: "intersection",
    description: "A ground-level footway passing under a footbridge is not connected",
    features: [
      {
        id: id(28, 1),
        geometry: { type: "cross", way: 338900300, segment: 0, fraction: 0.5, halfLengthMeters: 8 },
        tags: footway,
      },
    ],
    stages: [{ kind: "not-connected", feature: id(28, 1), crossedWay: 338900300 }],
    candidates: [],
  },
  {
    id: "I4",
    stage: "intersection",
    description: "A new building outline over a footway is not connected to it",
    features: [
      {
        id: id(29, 1),
        geometry: { type: "square", way: 104865113, segment: 0, fraction: 0.5, sizeMeters: 10 },
        tags: { building: "yes" },
      },
    ],
    stages: [{ kind: "not-connected", feature: id(29, 1), crossedWay: 104865113 }],
    candidates: [],
  },
  {
    id: "I5",
    stage: "intersection",
    description: "Two new footways crossing each other get a crossing node",
    features: [
      {
        id: id(30, 1),
        geometry: {
          type: "path",
          path: [
            { node: 5932249019, meters: 130, bearing: 90 },
            { node: 5932249019, meters: 150, bearing: 90 },
          ],
        },
        tags: footway,
      },
      {
        id: id(30, 2),
        geometry: {
          type: "path",
          path: [
            { offset: { node: 5932249019, meters: 140, bearing: 90 }, meters: 10, bearing: 0 },
            { offset: { node: 5932249019, meters: 140, bearing: 90 }, meters: 10, bearing: 180 },
          ],
        },
        tags: footway,
      },
    ],
    stages: [{ kind: "crossing-added", feature: id(30, 2), crossedWay: id(30, 1) }],
    candidates: [],
  },
];

/**
 * Scenarios that expose a merge bug. They are kept out of the main patch (one failure would
 * stop the whole merge) and each has a skipped test that reproduces it; unskip it with the fix.
 */
export const MONACO_MERGE_KNOWN_ISSUES: { issue: string; scenario: MergeScenario }[] = [];
