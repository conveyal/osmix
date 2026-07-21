import type { LonLat, RouteOptions } from "../../src/index.ts";

export type RoutingTestMode = "car" | "walk";

export type RoutingTestEndpoint =
  | { nodeId: number }
  | {
      coordinates: LonLat;
      maxSnapDistanceMeters: number;
    };

export interface RoutingPolicyLimitation {
  kind: "access" | "turn-restriction";
  reason: string;
  r5Expectation: string;
  witness: {
    type: "relation" | "way";
    id: number;
    tags: Readonly<Record<string, string>>;
  };
}

export interface RoutingTestExpectation {
  reachable?: boolean;
  distanceMeters?: { min: number; max: number };
  timeSeconds?: { min: number; max: number };
  requiredWayIds?: readonly number[];
  forbiddenWayIds?: readonly number[];
}

export interface RoutingTestCase {
  id: string;
  description: string;
  mode: RoutingTestMode;
  metric: RouteOptions["metric"];
  from: RoutingTestEndpoint;
  to: RoutingTestEndpoint;
  expect: RoutingTestExpectation;
  /** Optional test-only policy refinement; this is not a public Osmix routing profile. */
  graphPolicy?: "access-aware";
  policyLimitation?: RoutingPolicyLimitation;
}

/**
 * Routes whose OSM IDs and broad measurements are stable in the checked-in Monaco fixture.
 * Exact coordinate arrays are deliberately not golden data: they are too sensitive to harmless
 * encoding and graph-storage changes.
 */
export const MONACO_ROUTING_CASES = [
  {
    id: "monaco-short-drive",
    description: "Short drive through central Monaco",
    mode: "car",
    metric: "distance",
    from: { coordinates: [7.4229093, 43.7371175], maxSnapDistanceMeters: 100 },
    to: { coordinates: [7.4259193, 43.7377731], maxSnapDistanceMeters: 100 },
    expect: {
      reachable: true,
      distanceMeters: { min: 240, max: 270 },
      timeSeconds: { min: 15, max: 25 },
      requiredWayIds: [157719644, 254596486, 166624050],
    },
  },
  {
    id: "monaco-short-walk",
    description: "Walk between the same central Monaco points",
    mode: "walk",
    metric: "distance",
    from: { coordinates: [7.4229093, 43.7371175], maxSnapDistanceMeters: 100 },
    to: { coordinates: [7.4259193, 43.7377731], maxSnapDistanceMeters: 100 },
    expect: {
      reachable: true,
      distanceMeters: { min: 200, max: 500 },
    },
  },
  {
    id: "monaco-cross-town-drive",
    description: "West-to-east drive across Monaco's largest connected road component",
    mode: "car",
    metric: "distance",
    from: { nodeId: 4329343083 },
    to: { nodeId: 7779445520 },
    expect: {
      reachable: true,
      distanceMeters: { min: 5_650, max: 5_900 },
      timeSeconds: { min: 360, max: 390 },
      requiredWayIds: [239592573, 952419570, 161627743],
    },
  },
  {
    id: "monaco-streets-and-steps-walk",
    description: "Walk through ordinary streets, pedestrian ways, footways, and steps",
    mode: "walk",
    metric: "distance",
    from: { nodeId: 25182927 },
    to: { nodeId: 25181969 },
    expect: {
      reachable: true,
      distanceMeters: { min: 440, max: 480 },
      requiredWayIds: [4227157, 1082312632, 4227155, 167014909, 165636031],
    },
  },
  {
    id: "monaco-oneway-forward",
    description: "Drive with the tagged direction of Avenue des Papalins",
    mode: "car",
    metric: "distance",
    from: { nodeId: 25177418 },
    to: { nodeId: 25177397 },
    expect: {
      reachable: true,
      distanceMeters: { min: 30, max: 40 },
      timeSeconds: { min: 3, max: 5 },
      requiredWayIds: [4224972],
    },
  },
  {
    id: "monaco-oneway-reverse",
    description: "Reverse drive detours around Avenue des Papalins",
    mode: "car",
    metric: "distance",
    from: { nodeId: 25177397 },
    to: { nodeId: 25177418 },
    expect: {
      reachable: true,
      distanceMeters: { min: 120, max: 130 },
      timeSeconds: { min: 10, max: 13 },
      requiredWayIds: [4229273, 503462459, 804900035, 4229900, 503462460, 4229274],
      forbiddenWayIds: [4224972],
    },
  },
  {
    id: "monaco-reverse-oneway-legal",
    description: "Drive against stored node order where oneway=-1 permits that direction",
    mode: "car",
    metric: "distance",
    from: { nodeId: 4437836938 },
    to: { nodeId: 254470730 },
    expect: {
      reachable: true,
      distanceMeters: { min: 10, max: 12 },
      requiredWayIds: [158215200],
    },
  },
  {
    id: "monaco-reverse-oneway-detour",
    description: "Drive around the loop rather than forward against a oneway=-1 tag",
    mode: "car",
    metric: "distance",
    from: { nodeId: 254470730 },
    to: { nodeId: 4437836938 },
    expect: {
      reachable: true,
      distanceMeters: { min: 40, max: 43 },
      requiredWayIds: [158215200],
    },
  },
  {
    id: "monaco-implicit-roundabout-oneway",
    description: "Drive in the legal direction around the Avenue Albert II roundabout",
    mode: "car",
    metric: "distance",
    from: { nodeId: 25204713 },
    to: { nodeId: 25238111 },
    expect: {
      reachable: true,
      distanceMeters: { min: 60, max: 75 },
      timeSeconds: { min: 2, max: 6 },
      requiredWayIds: [4229900, 503462460, 503462476, 503462459, 804900035],
    },
  },
  {
    id: "monaco-motor-vehicle-access",
    description: "Car access witness on motor_vehicle=no Impasse du Stade",
    mode: "car",
    metric: "distance",
    from: { nodeId: 254470916 },
    to: { nodeId: 1704462513 },
    expect: {},
    policyLimitation: {
      kind: "access",
      reason: "Osmix's default vehicle filter currently checks highway class but not access tags.",
      r5Expectation: "A normal car route must not traverse way 158215187 because motor_vehicle=no.",
      witness: {
        type: "way",
        id: 158215187,
        tags: { highway: "service", motor_vehicle: "no" },
      },
    },
  },
  {
    id: "monaco-no-left-turn-restriction",
    description: "Prohibited turn witness for restriction relation 4261963",
    mode: "car",
    metric: "distance",
    from: { nodeId: 1704462546 },
    to: { nodeId: 1778433989 },
    expect: {},
    policyLimitation: {
      kind: "turn-restriction",
      reason: "Osmix's routing graph does not currently interpret restriction relations.",
      r5Expectation:
        "Do not transition directly from way 176527122 to way 166399477 through node 25177185.",
      witness: {
        type: "relation",
        id: 4261963,
        tags: { restriction: "no_left_turn", type: "restriction" },
      },
    },
  },
  {
    id: "monaco-tunnel-layer-regression",
    description: "Driving route that must not shortcut between nearby road levels",
    mode: "car",
    metric: "distance",
    from: { nodeId: 1866510534 },
    to: { nodeId: 937988247 },
    expect: {
      reachable: true,
      distanceMeters: { min: 1_000, max: 1_100 },
      timeSeconds: { min: 55, max: 70 },
    },
  },
  {
    id: "monaco-reachability-regression",
    description: "Driving route that became disconnected after unsafe node deduplication",
    mode: "car",
    metric: "distance",
    from: { nodeId: 1875118274 },
    to: { nodeId: 12281555152 },
    expect: {
      reachable: true,
      distanceMeters: { min: 150, max: 180 },
      timeSeconds: { min: 8, max: 15 },
    },
  },
  {
    id: "outside-monaco",
    description: "A point outside the extract cannot snap to its routing graph",
    mode: "car",
    metric: "distance",
    from: { coordinates: [0, 0], maxSnapDistanceMeters: 50 },
    to: { coordinates: [0.001, 0.001], maxSnapDistanceMeters: 50 },
    expect: { reachable: false },
  },
] as const satisfies readonly RoutingTestCase[];

export const SYNTHETIC_ROUTING_CASES = [
  {
    id: "synthetic-car-extension",
    description: "Cars use the residential base road and its merged extension",
    mode: "car",
    metric: "distance",
    from: { nodeId: 1 },
    to: { nodeId: 4 },
    expect: {
      reachable: true,
      distanceMeters: { min: 540, max: 570 },
      requiredWayIds: [100, 101],
      forbiddenWayIds: [102],
    },
  },
  {
    id: "synthetic-walk-shortcut",
    description: "Walkers can use the foot-only direct connection",
    mode: "walk",
    metric: "distance",
    from: { nodeId: 1 },
    to: { nodeId: 4 },
    expect: {
      reachable: true,
      distanceMeters: { min: 330, max: 340 },
      requiredWayIds: [102],
      forbiddenWayIds: [100, 101],
    },
  },
  {
    id: "synthetic-oneway-forward",
    description: "Driving follows a one-way road in its tagged direction",
    mode: "car",
    metric: "distance",
    from: { nodeId: 10 },
    to: { nodeId: 12 },
    expect: {
      reachable: true,
      distanceMeters: { min: 210, max: 230 },
      requiredWayIds: [110],
    },
  },
  {
    id: "synthetic-oneway-reverse",
    description: "Driving cannot reverse along a one-way road",
    mode: "car",
    metric: "distance",
    from: { nodeId: 12 },
    to: { nodeId: 10 },
    expect: { reachable: false },
  },
  {
    id: "synthetic-reverse-oneway-forward",
    description: "Driving cannot follow the stored order of a reverse one-way road",
    mode: "car",
    metric: "distance",
    from: { nodeId: 13 },
    to: { nodeId: 15 },
    expect: { reachable: false },
  },
  {
    id: "synthetic-reverse-oneway-reverse",
    description: "Driving follows a reverse one-way road against its stored node order",
    mode: "car",
    metric: "distance",
    from: { nodeId: 15 },
    to: { nodeId: 13 },
    expect: {
      reachable: true,
      distanceMeters: { min: 210, max: 230 },
      requiredWayIds: [111],
    },
  },
  {
    id: "synthetic-grade-separation",
    description: "A tunnel remains disconnected from the nearby surface road",
    mode: "car",
    metric: "distance",
    from: { nodeId: 21 },
    to: { nodeId: 23 },
    expect: { reachable: false },
  },
  {
    id: "synthetic-same-grade-crossing",
    description: "A same-grade crossing creates a routable connection",
    mode: "car",
    metric: "distance",
    from: { nodeId: 40 },
    to: { nodeId: 51 },
    expect: {
      reachable: true,
      distanceMeters: { min: 325, max: 345 },
      requiredWayIds: [130, 131],
    },
  },
  {
    id: "synthetic-reverse-multiple-intersections",
    description: "Routing follows a reverse-ordered way after two intersections are inserted",
    mode: "car",
    metric: "distance",
    from: { nodeId: 61 },
    to: { nodeId: 63 },
    expect: {
      reachable: true,
      distanceMeters: { min: 435, max: 455 },
      requiredWayIds: [140, 141],
    },
  },
  {
    id: "synthetic-access-car",
    description: "Cars detour around a residential way tagged motor_vehicle=no",
    mode: "car",
    metric: "distance",
    from: { nodeId: 70 },
    to: { nodeId: 72 },
    graphPolicy: "access-aware",
    expect: {
      reachable: true,
      distanceMeters: { min: 305, max: 325 },
      requiredWayIds: [151],
      forbiddenWayIds: [150],
    },
  },
  {
    id: "synthetic-access-walk",
    description: "Walking may use a residential way explicitly designated for foot access",
    mode: "walk",
    metric: "distance",
    from: { nodeId: 70 },
    to: { nodeId: 72 },
    expect: {
      reachable: true,
      distanceMeters: { min: 215, max: 230 },
      requiredWayIds: [150],
      forbiddenWayIds: [151],
    },
  },
] as const satisfies readonly RoutingTestCase[];

/** The offset sidewalk inputs before fuzzy attachment remain separate WALK components. */
export const SYNTHETIC_CONFLATION_DISCONNECTED_CASES = [
  {
    id: "synthetic-conflation-walk",
    description: "The imported sidewalk is disconnected before fuzzy network attachment",
    mode: "walk",
    metric: "distance",
    from: { nodeId: 801 },
    to: { nodeId: 902 },
    expect: { reachable: false },
  },
  {
    id: "synthetic-conflation-car",
    description: "Pedestrian-only source and target geometry is unavailable to cars",
    mode: "car",
    metric: "distance",
    from: { nodeId: 801 },
    to: { nodeId: 902 },
    expect: { reachable: false },
  },
] as const satisfies readonly RoutingTestCase[];

/** The same sidewalk pair after accepting its high-confidence pedestrian attachment. */
export const SYNTHETIC_CONFLATION_ATTACHED_CASES = [
  {
    id: "synthetic-conflation-walk",
    description: "Fuzzy attachment joins the aligned imported and base sidewalks",
    mode: "walk",
    metric: "distance",
    from: { nodeId: 801 },
    to: { nodeId: 902 },
    expect: {
      reachable: true,
      distanceMeters: { min: 215, max: 230 },
      requiredWayIds: [810, 910],
    },
  },
  {
    id: "synthetic-conflation-car",
    description: "A pedestrian attachment does not introduce a car route",
    mode: "car",
    metric: "distance",
    from: { nodeId: 801 },
    to: { nodeId: 902 },
    expect: { reachable: false },
  },
] as const satisfies readonly RoutingTestCase[];
