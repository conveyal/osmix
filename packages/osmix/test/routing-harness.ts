import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";

import type { FeatureCollection, LineString } from "geojson";

import {
  defaultHighwayFilter,
  type HighwayFilter,
  type LonLat,
  type Osm,
  type OsmTags,
  Router,
  RoutingGraph,
  toPbfBuffer,
} from "../src/index.ts";
import type {
  RoutingTestCase,
  RoutingTestEndpoint,
  RoutingTestMode,
  RoutingPolicyLimitation,
} from "./fixtures/routing-cases.ts";

const WALK_SPEEDS = {
  bridleway: 5,
  cycleway: 5,
  footway: 5,
  living_street: 5,
  path: 5,
  pedestrian: 5,
  primary: 5,
  residential: 5,
  secondary: 5,
  service: 5,
  steps: 2,
  tertiary: 5,
  track: 5,
  unclassified: 5,
};

const WALKABLE_HIGHWAYS = new Set(Object.keys(WALK_SPEEDS));
const POSITIVE_ACCESS_VALUES = new Set(["designated", "destination", "permissive", "yes"]);
const NEGATIVE_ACCESS_VALUES = new Set(["no", "private"]);

/**
 * Test-only subset of R5's motor-vehicle access policy. This deliberately does not model
 * conditional access, barriers, or every OSM vehicle class and is not a public routing profile.
 */
export const routingTestCarAccessFilter: HighwayFilter = (tags?: OsmTags): boolean => {
  if (!defaultHighwayFilter(tags)) return false;
  const access =
    tags?.["motorcar"] ?? tags?.["motor_vehicle"] ?? tags?.["vehicle"] ?? tags?.["access"];
  return !NEGATIVE_ACCESS_VALUES.has(String(access));
};

/** Test-only pedestrian policy; this does not establish complete production access semantics. */
export const routingTestWalkFilter: HighwayFilter = (tags?: OsmTags): boolean => {
  const highway = tags?.["highway"];
  if (!highway || !WALKABLE_HIGHWAYS.has(String(highway))) return false;
  if (tags["foot"] === "no" || tags["foot"] === "private") return false;

  const access = tags["access"];
  if (access === "no" || access === "private") {
    return POSITIVE_ACCESS_VALUES.has(String(tags["foot"]));
  }

  return true;
};

export interface RoutingGraphReport {
  nodes: number;
  edges: number;
  weakComponents: number;
}

export interface RoutingEndpointReport {
  nodeId: number;
  coordinates: LonLat;
  snapDistanceMeters: number;
  resolution: "osm-node-id" | "nearest-routable-node";
}

export interface RoutingPathReport {
  nodeIds: number[];
  wayIds: number[];
  highways: string[];
  coordinates: LonLat[];
  distanceMeters: number;
  timeSeconds: number;
  optimizedCost: number;
  edges: { fromNodeId: number; toNodeId: number; wayId: number }[];
}

interface RoutingCaseEvidence {
  caseId: string;
  mode: RoutingTestMode;
  graphPolicy: "access-aware" | "osmix-default";
  metric: RoutingTestCase["metric"];
  graph: RoutingGraphReport;
  from: RoutingEndpointReport | null;
  to: RoutingEndpointReport | null;
  reachable: boolean;
  /** Null when unresolved endpoints prevented both algorithms from running. */
  algorithmAgreement: boolean | null;
  algorithmCosts: { astar: number | null; dijkstra: number | null };
  policyLimitation?: RoutingPolicyLimitation;
  path: RoutingPathReport | null;
}

export interface RoutingVerification {
  kind: "asserted-route" | "policy-diagnostic";
  status: "passed" | "failed" | "diagnostic-only" | "not-applicable" | "unavailable";
  checks: {
    name: string;
    outcome: "passed" | "failed" | "not-applicable" | "unavailable";
    routeAssertion: boolean;
  }[];
}

export interface RoutingCaseReport extends RoutingCaseEvidence {
  verification: RoutingVerification;
}

/** Evaluate only declared expectations; a policy limitation never suppresses a declared check. */
export function verifyRoutingCaseReport(
  report: RoutingCaseEvidence,
  testCase: RoutingTestCase,
): RoutingVerification {
  const checks: RoutingVerification["checks"] = [];
  const check = (name: string, passed: boolean, routeAssertion = false) => {
    checks.push({ name, outcome: passed ? "passed" : "failed", routeAssertion });
  };
  const endpointsResolved = report.from !== null && report.to !== null;
  const routeCheck = (name: string, passed: boolean) => {
    checks.push({
      name,
      outcome: !endpointsResolved ? "unavailable" : passed ? "passed" : "failed",
      routeAssertion: true,
    });
  };
  check("case-id", report.caseId === testCase.id);
  check("graph-policy", report.graphPolicy === (testCase.graphPolicy ?? "osmix-default"));
  checks.push({
    name: "algorithm-agreement",
    outcome:
      report.algorithmAgreement === null
        ? "not-applicable"
        : report.algorithmAgreement
          ? "passed"
          : "failed",
    routeAssertion: false,
  });
  check("route-evidence-consistency", report.reachable === (report.path !== null));
  for (const side of ["from", "to"] as const) {
    const endpoint = testCase[side];
    const resolved = report[side];
    if (resolved && "nodeId" in endpoint) {
      check(
        `${side}-osm-node-identity`,
        resolved.nodeId === endpoint.nodeId && resolved.resolution === "osm-node-id",
      );
    }
  }

  const expected = testCase.expect;
  if (expected.reachable !== undefined) {
    routeCheck("reachability", report.reachable === expected.reachable);
    if (expected.reachable) check("resolved-endpoints", report.from !== null && report.to !== null);
  } else if (!testCase.policyLimitation) {
    check("declared-reachability", false, true);
  }
  if (testCase.policyLimitation) {
    check("diagnostic-endpoints", report.from !== null && report.to !== null);
  }

  for (const metric of ["distanceMeters", "timeSeconds"] as const) {
    const bounds = expected[metric];
    if (!bounds) continue;
    const value = report.path?.[metric];
    routeCheck(metric, value !== undefined && value >= bounds.min && value <= bounds.max);
  }
  for (const id of expected.requiredWayIds ?? []) {
    routeCheck(`required-way:${id}`, report.path?.wayIds.includes(id) === true);
  }
  const forbidden = (name: string, present: boolean) => {
    checks.push({
      name,
      outcome: !endpointsResolved
        ? "unavailable"
        : report.path === null
          ? "not-applicable"
          : present
            ? "failed"
            : "passed",
      routeAssertion: true,
    });
  };
  for (const id of expected.forbiddenWayIds ?? []) {
    forbidden(`forbidden-way:${id}`, report.path?.wayIds.includes(id) === true);
  }
  for (const turn of expected.forbiddenTransitions ?? []) {
    forbidden(
      `forbidden-transition:${turn.fromWayId}/${turn.viaNodeId}/${turn.toWayId}`,
      report.path?.edges.some((edge, index, edges) => {
        const next = edges[index + 1];
        return (
          edge.wayId === turn.fromWayId &&
          edge.toNodeId === turn.viaNodeId &&
          next?.fromNodeId === turn.viaNodeId &&
          next.wayId === turn.toWayId
        );
      }) === true,
    );
  }
  const asserted = checks.some((item) => item.routeAssertion);
  const applicable = checks.some(
    (item) => item.routeAssertion && item.outcome !== "not-applicable",
  );
  return {
    kind: asserted ? "asserted-route" : "policy-diagnostic",
    status: checks.some((item) => item.outcome === "failed")
      ? "failed"
      : checks.some((item) => item.outcome === "unavailable")
        ? "unavailable"
        : asserted
          ? applicable
            ? "passed"
            : "not-applicable"
          : "diagnostic-only",
    checks,
  };
}

export function summarizeRoutingVerification(reports: readonly RoutingCaseReport[]) {
  return {
    assertedCases: reports.filter((report) => report.verification.kind === "asserted-route").length,
    diagnosticCases: reports.filter((report) => report.verification.kind === "policy-diagnostic")
      .length,
    failedCases: reports.filter((report) => report.verification.status === "failed").length,
    unavailableCases: reports.filter((report) => report.verification.status === "unavailable")
      .length,
    passedCases: reports.filter((report) => report.verification.status === "passed").length,
    passedRouteChecks: reports
      .flatMap((report) => report.verification.checks)
      .filter((check) => check.routeAssertion && check.outcome === "passed").length,
    notApplicableRouteChecks: reports
      .flatMap((report) => report.verification.checks)
      .filter((check) => check.routeAssertion && check.outcome === "not-applicable").length,
    unavailableRouteChecks: reports
      .flatMap((report) => report.verification.checks)
      .filter((check) => check.routeAssertion && check.outcome === "unavailable").length,
  };
}

interface RoutingContext {
  graph: RoutingGraph;
  report: RoutingGraphReport;
  router: Router;
}

type RoutingContextKey = RoutingTestMode | "car-access-aware";

function countWeakComponents(graph: RoutingGraph): number {
  const parents = Uint32Array.from({ length: graph.size }, (_, index) => index);
  const routable = new Uint8Array(graph.size);

  const find = (value: number): number => {
    let root = value;
    while (parents[root] !== root) root = parents[root]!;
    let cursor = value;
    while (parents[cursor] !== cursor) {
      const next = parents[cursor]!;
      parents[cursor] = root;
      cursor = next;
    }
    return root;
  };

  const union = (left: number, right: number): void => {
    const leftRoot = find(left);
    const rightRoot = find(right);
    if (leftRoot !== rightRoot) parents[rightRoot] = leftRoot;
  };

  for (let nodeIndex = 0; nodeIndex < graph.size; nodeIndex++) {
    if (!graph.isRoutable(nodeIndex)) continue;
    routable[nodeIndex] = 1;
    for (const edge of graph.getEdges(nodeIndex)) union(nodeIndex, edge.targetNodeIndex);
  }

  const roots = new Set<number>();
  for (let nodeIndex = 0; nodeIndex < graph.size; nodeIndex++) {
    if (routable[nodeIndex]) roots.add(find(nodeIndex));
  }
  return roots.size;
}

function buildContext(osm: Osm, mode: RoutingContextKey): RoutingContext {
  let graph: RoutingGraph;
  if (mode === "walk") graph = new RoutingGraph(osm, routingTestWalkFilter, WALK_SPEEDS);
  else if (mode === "car-access-aware") graph = new RoutingGraph(osm, routingTestCarAccessFilter);
  else graph = new RoutingGraph(osm, defaultHighwayFilter);
  return {
    graph,
    router: new Router(osm, graph),
    report: {
      nodes: graph.size,
      edges: graph.edges,
      weakComponents: countWeakComponents(graph),
    },
  };
}

function resolveEndpoint(
  osm: Osm,
  graph: RoutingGraph,
  endpoint: RoutingTestEndpoint,
): RoutingEndpointReport | null {
  if ("nodeId" in endpoint) {
    const nodeIndex = osm.nodes.ids.getIndexFromId(endpoint.nodeId);
    if (nodeIndex === -1 || !graph.isRoutable(nodeIndex)) return null;
    return {
      nodeId: endpoint.nodeId,
      coordinates: osm.nodes.getNodeLonLat({ index: nodeIndex }),
      snapDistanceMeters: 0,
      resolution: "osm-node-id",
    };
  }

  const nearest = graph.findNearestRoutableNode(
    osm,
    endpoint.coordinates,
    endpoint.maxSnapDistanceMeters,
  );
  if (!nearest) return null;
  return {
    nodeId: osm.nodes.ids.at(nearest.nodeIndex),
    coordinates: nearest.coordinates,
    snapDistanceMeters: nearest.distance,
    resolution: "nearest-routable-node",
  };
}

function uniqueConsecutive<T>(values: readonly T[]): T[] {
  return values.filter((value, index) => index === 0 || value !== values[index - 1]);
}

function routeCase(
  osm: Osm,
  context: RoutingContext,
  testCase: RoutingTestCase,
): RoutingCaseEvidence {
  const from = resolveEndpoint(osm, context.graph, testCase.from);
  const to = resolveEndpoint(osm, context.graph, testCase.to);
  if (!from || !to) {
    return {
      caseId: testCase.id,
      mode: testCase.mode,
      graphPolicy: testCase.graphPolicy ?? "osmix-default",
      metric: testCase.metric,
      graph: context.report,
      from,
      to,
      reachable: false,
      algorithmAgreement: null,
      algorithmCosts: { astar: null, dijkstra: null },
      policyLimitation: testCase.policyLimitation,
      path: null,
    };
  }

  const fromIndex = osm.nodes.ids.getIndexFromId(from.nodeId);
  const toIndex = osm.nodes.ids.getIndexFromId(to.nodeId);
  const routeOptions = { metric: testCase.metric } as const;
  const dijkstra = context.router.route(fromIndex, toIndex, {
    ...routeOptions,
    algorithm: "dijkstra",
  });
  const astar = context.router.route(fromIndex, toIndex, {
    ...routeOptions,
    algorithm: "astar",
  });
  const bothReachable = dijkstra !== null && astar !== null;
  const bothUnreachable = dijkstra === null && astar === null;
  const algorithmAgreement =
    bothUnreachable ||
    (bothReachable &&
      Math.abs(dijkstra.at(-1)!.cost - astar.at(-1)!.cost) <=
        Math.max(0.001, Math.abs(dijkstra.at(-1)!.cost) * 1e-6));

  if (!dijkstra) {
    return {
      caseId: testCase.id,
      mode: testCase.mode,
      graphPolicy: testCase.graphPolicy ?? "osmix-default",
      metric: testCase.metric,
      graph: context.report,
      from,
      to,
      reachable: false,
      algorithmAgreement,
      algorithmCosts: { astar: astar?.at(-1)?.cost ?? null, dijkstra: null },
      policyLimitation: testCase.policyLimitation,
      path: null,
    };
  }

  const stats = context.router.getRouteStatistics(dijkstra);
  const wayIndexes = uniqueConsecutive(
    dijkstra.flatMap((segment) => (segment.wayIndex === undefined ? [] : [segment.wayIndex])),
  );
  return {
    caseId: testCase.id,
    mode: testCase.mode,
    graphPolicy: testCase.graphPolicy ?? "osmix-default",
    metric: testCase.metric,
    graph: context.report,
    from,
    to,
    reachable: true,
    algorithmAgreement,
    algorithmCosts: {
      astar: astar?.at(-1)?.cost ?? null,
      dijkstra: dijkstra.at(-1)!.cost,
    },
    policyLimitation: testCase.policyLimitation,
    path: {
      nodeIds: dijkstra.map((segment) => osm.nodes.ids.at(segment.nodeIndex)),
      wayIds: wayIndexes.map((wayIndex) => osm.ways.ids.at(wayIndex)),
      highways: wayIndexes.map((wayIndex) =>
        String(osm.ways.tags.getTags(wayIndex)?.["highway"] ?? ""),
      ),
      coordinates: dijkstra.map((segment) => osm.nodes.getNodeLonLat({ index: segment.nodeIndex })),
      distanceMeters: stats.distance,
      timeSeconds: stats.time,
      optimizedCost: dijkstra.at(-1)!.cost,
      edges: dijkstra.flatMap((segment) =>
        segment.wayIndex === undefined || segment.previousNodeIndex === undefined
          ? []
          : [
              {
                fromNodeId: osm.nodes.ids.at(segment.previousNodeIndex),
                toNodeId: osm.nodes.ids.at(segment.nodeIndex),
                wayId: osm.ways.ids.at(segment.wayIndex),
              },
            ],
      ),
    },
  };
}

export class RoutingTestHarness {
  readonly osm: Osm;
  readonly contexts: Record<RoutingContextKey, RoutingContext>;

  constructor(osm: Osm) {
    this.osm = osm;
    this.contexts = {
      car: buildContext(osm, "car"),
      "car-access-aware": buildContext(osm, "car-access-aware"),
      walk: buildContext(osm, "walk"),
    };
  }

  run(testCase: RoutingTestCase): RoutingCaseReport {
    const contextKey =
      testCase.mode === "car" && testCase.graphPolicy === "access-aware"
        ? "car-access-aware"
        : testCase.mode;
    const report = routeCase(this.osm, this.contexts[contextKey], testCase);
    return { ...report, verification: verifyRoutingCaseReport(report, testCase) };
  }

  runAll(testCases: readonly RoutingTestCase[]): RoutingCaseReport[] {
    return testCases.map((testCase) => this.run(testCase));
  }
}

export function stableRoutingReport(report: RoutingCaseReport) {
  return {
    caseId: report.caseId,
    mode: report.mode,
    graphPolicy: report.graphPolicy,
    metric: report.metric,
    graph: report.graph,
    fromNodeId: report.from?.nodeId ?? null,
    toNodeId: report.to?.nodeId ?? null,
    fromResolution: report.from?.resolution ?? "unresolved",
    toResolution: report.to?.resolution ?? "unresolved",
    reachable: report.reachable,
    algorithmAgreement: report.algorithmAgreement,
    algorithmCosts: {
      astar:
        report.algorithmCosts.astar === null
          ? null
          : Number(report.algorithmCosts.astar.toFixed(3)),
      dijkstra:
        report.algorithmCosts.dijkstra === null
          ? null
          : Number(report.algorithmCosts.dijkstra.toFixed(3)),
    },
    policyLimitation: report.policyLimitation,
    verification: report.verification,
    path: report.path
      ? {
          nodeIds: report.path.nodeIds,
          wayIds: report.path.wayIds,
          highways: report.path.highways,
          distanceMeters: Number(report.path.distanceMeters.toFixed(3)),
          timeSeconds: Number(report.path.timeSeconds.toFixed(3)),
          optimizedCost: Number(report.path.optimizedCost.toFixed(3)),
          edges: report.path.edges,
        }
      : null,
  };
}

export function routingReportsToGeoJson(
  reports: readonly RoutingCaseReport[],
): FeatureCollection<LineString> {
  return {
    type: "FeatureCollection",
    features: reports.flatMap((report) =>
      report.path
        ? [
            {
              type: "Feature" as const,
              properties: {
                caseId: report.caseId,
                mode: report.mode,
                distanceMeters: report.path.distanceMeters,
                timeSeconds: report.path.timeSeconds,
                wayIds: report.path.wayIds.join(","),
                verificationKind: report.verification.kind,
                verificationStatus: report.verification.status,
              },
              geometry: {
                type: "LineString" as const,
                coordinates: report.path.coordinates,
              },
            },
          ]
        : [],
    ),
  };
}

/** Write diagnostics only when explicitly called by a developer or debugging script. */
export async function writeRoutingDiagnostics(
  reports: readonly RoutingCaseReport[],
  directory: string,
): Promise<void> {
  await mkdir(directory, { recursive: true });
  await Promise.all([
    writeFile(
      join(directory, "routing-verification.json"),
      `${JSON.stringify(summarizeRoutingVerification(reports), null, 2)}\n`,
    ),
    writeFile(
      join(directory, "routing-report.json"),
      `${JSON.stringify(reports.map(stableRoutingReport), null, 2)}\n`,
    ),
    writeFile(
      join(directory, "routing-routes.geojson"),
      `${JSON.stringify(routingReportsToGeoJson(reports), null, 2)}\n`,
    ),
  ]);
}

export interface R5OracleDataset {
  id: string;
  osm: Osm;
  reports: readonly RoutingCaseReport[];
}

function tsvCell(value: boolean | number | string | undefined): string {
  return String(value ?? "")
    .replaceAll("\t", " ")
    .replaceAll("\r", " ")
    .replaceAll("\n", " ");
}

/**
 * Export exact PBF inputs, snapped coordinates, and Osmix diagnostics for an opt-in local R5 run.
 * This is intentionally called only behind an environment variable in the regression test.
 */
export async function writeR5OracleArtifacts(
  datasets: readonly R5OracleDataset[],
  testCases: readonly RoutingTestCase[],
  directory: string,
): Promise<void> {
  await mkdir(directory, { recursive: true });

  const referenceReports = new Map(datasets[0]?.reports.map((report) => [report.caseId, report]));
  const endpointCoordinates = (
    endpoint: RoutingTestEndpoint,
    resolved: RoutingEndpointReport | null | undefined,
  ) => {
    if (resolved) return resolved.coordinates;
    if ("coordinates" in endpoint) return endpoint.coordinates;
    const node = datasets[0]?.osm.nodes.getById(endpoint.nodeId);
    return node ? [node.lon, node.lat] : undefined;
  };
  const routeRows = testCases.map((testCase) => {
    const report = referenceReports.get(testCase.id);
    const fromCoordinates = endpointCoordinates(testCase.from, report?.from);
    const toCoordinates = endpointCoordinates(testCase.to, report?.to);
    return [
      testCase.id,
      testCase.mode.toUpperCase(),
      fromCoordinates?.[0],
      fromCoordinates?.[1],
      toCoordinates?.[0],
      toCoordinates?.[1],
      "nodeId" in testCase.from ? "osm-node" : "coordinate",
      "nodeId" in testCase.from ? testCase.from.nodeId : undefined,
      "nodeId" in testCase.to ? "osm-node" : "coordinate",
      "nodeId" in testCase.to ? testCase.to.nodeId : undefined,
      report?.verification.kind ?? "unavailable",
      testCase.expect.reachable,
      testCase.expect.distanceMeters?.min,
      testCase.expect.distanceMeters?.max,
      testCase.policyLimitation?.r5Expectation ?? "",
      testCase.r5Expect?.reachable,
      JSON.stringify(testCase.r5Expect?.forbiddenWayIds ?? []),
      JSON.stringify(testCase.r5Expect?.forbiddenWayTransitions ?? []),
      report?.from?.nodeId,
      report?.to?.nodeId,
      report?.from?.resolution ?? "unresolved",
      report?.to?.resolution ?? "unresolved",
    ].map(tsvCell);
  });
  const manifestRows = [
    [
      "case_id",
      "mode",
      "from_lon",
      "from_lat",
      "to_lon",
      "to_lat",
      "from_endpoint_kind",
      "from_osm_node_id",
      "to_endpoint_kind",
      "to_osm_node_id",
      "expectation_kind",
      "expected_reachable",
      "expected_distance_min_m",
      "expected_distance_max_m",
      "r5_expectation",
      "r5_expected_reachable",
      "r5_forbidden_way_ids",
      "r5_forbidden_way_transitions",
      "from_osmix_resolved_node_id",
      "to_osmix_resolved_node_id",
      "from_osmix_resolution",
      "to_osmix_resolution",
    ],
    ...routeRows,
  ];

  await Promise.all([
    writeFile(
      join(directory, "routing-cases.tsv"),
      `${manifestRows.map((row) => row.join("\t")).join("\n")}\n`,
    ),
    writeFile(
      join(directory, "oracle-matrix.json"),
      `${JSON.stringify(
        {
          schemaVersion: 2,
          note: "Local diagnostic output; it is not a checked-in golden and is never auto-updated.",
          datasets: datasets.map((dataset) => ({
            id: dataset.id,
            pbf: `${dataset.id}.osm.pbf`,
            osmix: dataset.reports.map(stableRoutingReport),
            verification: summarizeRoutingVerification(dataset.reports),
          })),
        },
        null,
        2,
      )}\n`,
    ),
    ...datasets.flatMap((dataset) => [
      toPbfBuffer(dataset.osm).then((pbf) =>
        writeFile(join(directory, `${dataset.id}.osm.pbf`), pbf),
      ),
      writeRoutingDiagnostics(dataset.reports, join(directory, dataset.id)),
    ]),
  ]);
}
