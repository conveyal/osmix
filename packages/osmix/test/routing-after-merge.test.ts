import { createHash } from "node:crypto";
import { join } from "node:path";

import { getFixtureFile, PBFs } from "@osmix/test-utils/fixtures";
import { beforeAll, describe, expect, it } from "vitest";

import { fromPbf, merge, Osm, type OsmEntity, toPbfBuffer } from "../src/index.ts";
import {
  MONACO_ROUTING_CASES,
  SYNTHETIC_CONFLATION_ATTACHED_CASES,
  SYNTHETIC_CONFLATION_DISCONNECTED_CASES,
  SYNTHETIC_ROUTING_CASES,
  type RoutingTestCase,
} from "./fixtures/routing-cases.ts";
import {
  type RoutingCaseReport,
  RoutingTestHarness,
  stableRoutingReport,
  writeR5OracleArtifacts,
  writeRoutingDiagnostics,
} from "./routing-harness.ts";
import {
  createMonacoRoutingPatch,
  createMergedSyntheticRoutingOsm,
  createSyntheticConflationRoutingVariants,
  roundTripRoutingOsm,
} from "./synthetic-routing-fixture.ts";

const ALL_MERGE_STEPS = {
  createIntersections: true,
  deduplicateNodes: true,
  deduplicateWays: true,
  directMerge: true,
} as const;

function canonicalOsmDigest(osm: Osm): string {
  const hash = createHash("sha256");
  const updateEntities = (type: string, entities: Iterable<OsmEntity>): void => {
    hash.update(type);
    for (const entity of entities) hash.update(JSON.stringify(entity));
  };
  updateEntities("nodes", osm.nodes.sorted());
  updateEntities("ways", osm.ways.sorted());
  updateEntities("relations", osm.relations.sorted());
  return hash.digest("hex");
}

function topologyFingerprint(osm: Osm): string {
  return JSON.stringify({
    nodes: [...osm.nodes.sorted()].map(({ id, lat, lon }) => ({ id, lat, lon })),
    ways: [...osm.ways.sorted()].map(({ id, refs }) => ({ id, refs })),
    relations: [...osm.relations.sorted()].map(({ id, members }) => ({ id, members })),
  });
}

function expectReportToMatchCase(report: RoutingCaseReport, testCase: RoutingTestCase): void {
  expect(report.caseId).toBe(testCase.id);
  expect(report.graphPolicy).toBe(testCase.graphPolicy ?? "osmix-default");
  expect
    .soft(
      report.algorithmAgreement,
      `${testCase.id}: Dijkstra and A* disagree (${JSON.stringify(report.algorithmCosts)})`,
    )
    .toBe(true);

  if (testCase.policyLimitation) {
    expect(report.from, `${testCase.id}: policy-witness origin did not resolve`).not.toBeNull();
    expect(report.to, `${testCase.id}: policy-witness destination did not resolve`).not.toBeNull();
    return;
  }

  if (testCase.expect.reachable === undefined) {
    throw new Error(`${testCase.id}: non-policy cases must declare reachability`);
  }
  expect(report.reachable).toBe(testCase.expect.reachable);

  if (!testCase.expect.reachable) {
    expect(report.path).toBeNull();
    return;
  }

  expect(report.from, `${testCase.id}: origin did not resolve`).not.toBeNull();
  expect(report.to, `${testCase.id}: destination did not resolve`).not.toBeNull();
  expect(report.path, `${testCase.id}: expected a route`).not.toBeNull();
  if (!report.path) return;

  const { distanceMeters, timeSeconds, wayIds } = report.path;
  const distance = testCase.expect.distanceMeters;
  if (distance) {
    expect(distanceMeters).toBeGreaterThanOrEqual(distance.min);
    expect(distanceMeters).toBeLessThanOrEqual(distance.max);
  }
  const time = testCase.expect.timeSeconds;
  if (time) {
    expect(timeSeconds).toBeGreaterThanOrEqual(time.min);
    expect(timeSeconds).toBeLessThanOrEqual(time.max);
  }
  for (const wayId of testCase.expect.requiredWayIds ?? []) expect(wayIds).toContain(wayId);
  for (const wayId of testCase.expect.forbiddenWayIds ?? []) {
    expect(wayIds).not.toContain(wayId);
  }
}

function expectReportsToMatchCases(
  reports: readonly RoutingCaseReport[],
  testCases: readonly RoutingTestCase[],
): void {
  expect(reports).toHaveLength(testCases.length);
  for (const [index, testCase] of testCases.entries()) {
    expectReportToMatchCase(reports[index]!, testCase);
  }
}

function stableReports(
  reports: readonly RoutingCaseReport[],
  testCases: readonly RoutingTestCase[],
) {
  return reports.map((report, index) => {
    const testCase = testCases[index]!;
    if (!testCase.policyLimitation) return stableRoutingReport(report);
    return {
      caseId: report.caseId,
      mode: report.mode,
      graphPolicy: report.graphPolicy,
      metric: report.metric,
      graph: report.graph,
      fromNodeId: report.from?.nodeId ?? null,
      toNodeId: report.to?.nodeId ?? null,
      algorithmAgreement: report.algorithmAgreement,
      policyLimitation: report.policyLimitation,
    };
  });
}

function stableRouteBehavior(
  reports: readonly RoutingCaseReport[],
  testCases: readonly RoutingTestCase[],
) {
  return stableReports(reports, testCases).map(({ graph: _graph, ...report }) => report);
}

function expectPolicyWitnesses(osm: Osm, testCases: readonly RoutingTestCase[]): void {
  for (const testCase of testCases) {
    const witness = testCase.policyLimitation?.witness;
    if (!witness) continue;
    const entity =
      witness.type === "way" ? osm.ways.getById(witness.id) : osm.relations.getById(witness.id);
    expect(
      entity,
      `${testCase.id}: policy witness ${witness.type} ${witness.id} is missing`,
    ).not.toBeNull();
    expect(entity?.tags).toMatchObject(witness.tags);
  }
}

describe("routing after a Monaco merge", () => {
  let raw: Osm;
  let merged: Osm;
  let roundTripped: Osm;
  let patched: Osm;
  let patchedRoundTripped: Osm;
  let rawReports: RoutingCaseReport[];
  let mergedReports: RoutingCaseReport[];
  let roundTripReports: RoutingCaseReport[];
  let patchedReports: RoutingCaseReport[];
  let patchedRoundTripReports: RoutingCaseReport[];

  beforeAll(async () => {
    raw = await fromPbf(await getFixtureFile(PBFs["monaco"]!.url), { id: "monaco-raw" });
    const emptyPatch = new Osm({ id: "empty-patch" });
    emptyPatch.buildIndexes();
    emptyPatch.buildSpatialIndexes();
    merged = await merge(raw, emptyPatch, ALL_MERGE_STEPS, () => undefined);
    roundTripped = await roundTripRoutingOsm(merged, "monaco-merged-roundtrip");
    const syntheticPatch = await roundTripRoutingOsm(createMonacoRoutingPatch(raw));
    patched = await merge(raw, syntheticPatch, ALL_MERGE_STEPS, () => undefined);
    patchedRoundTripped = await roundTripRoutingOsm(patched, "monaco-synthetic-patch-roundtrip");

    rawReports = new RoutingTestHarness(raw).runAll(MONACO_ROUTING_CASES);
    mergedReports = new RoutingTestHarness(merged).runAll(MONACO_ROUTING_CASES);
    roundTripReports = new RoutingTestHarness(roundTripped).runAll(MONACO_ROUTING_CASES);
    patchedReports = new RoutingTestHarness(patched).runAll(MONACO_ROUTING_CASES);
    patchedRoundTripReports = new RoutingTestHarness(patchedRoundTripped).runAll(
      MONACO_ROUTING_CASES,
    );

    const diagnosticsDirectory = process.env["OSMIX_ROUTING_DIAGNOSTICS_DIR"];
    if (diagnosticsDirectory) await writeRoutingDiagnostics(rawReports, diagnosticsDirectory);
    const r5OracleDirectory = process.env["OSMIX_ROUTING_ORACLE_DIR"];
    if (r5OracleDirectory) {
      await writeR5OracleArtifacts(
        [
          { id: "monaco-raw", osm: raw, reports: rawReports },
          { id: "monaco-empty-merge", osm: merged, reports: mergedReports },
          {
            id: "monaco-empty-merge-roundtrip",
            osm: roundTripped,
            reports: roundTripReports,
          },
          { id: "monaco-synthetic-patch", osm: patched, reports: patchedReports },
          {
            id: "monaco-synthetic-patch-roundtrip",
            osm: patchedRoundTripped,
            reports: patchedRoundTripReports,
          },
        ],
        MONACO_ROUTING_CASES,
        r5OracleDirectory,
      );
    }
  }, 30_000);

  it("keeps an empty all-steps merge as a canonical identity operation", () => {
    expect({
      nodes: merged.nodes.size,
      ways: merged.ways.size,
      relations: merged.relations.size,
    }).toEqual({ nodes: 14_286, ways: 3_346, relations: 46 });
    expect(canonicalOsmDigest(merged)).toBe(canonicalOsmDigest(raw));
  });

  it("preserves driving and walking routes after the empty merge", () => {
    expect(rawReports.find((report) => report.caseId === "monaco-short-drive")?.graph).toEqual({
      nodes: 14_286,
      edges: 10_831,
      weakComponents: 6,
    });
    expect(rawReports.find((report) => report.caseId === "monaco-short-walk")?.graph).toEqual({
      nodes: 14_286,
      edges: 25_750,
      weakComponents: 27,
    });
    expectReportsToMatchCases(rawReports, MONACO_ROUTING_CASES);
    expectReportsToMatchCases(mergedReports, MONACO_ROUTING_CASES);
    expectPolicyWitnesses(raw, MONACO_ROUTING_CASES);
    expectPolicyWitnesses(merged, MONACO_ROUTING_CASES);
    expect(stableReports(mergedReports, MONACO_ROUTING_CASES)).toEqual(
      stableReports(rawReports, MONACO_ROUTING_CASES),
    );
  });

  it("preserves stable routing topology through PBF serialization", () => {
    expect(canonicalOsmDigest(roundTripped)).toBe(canonicalOsmDigest(merged));
    expectReportsToMatchCases(roundTripReports, MONACO_ROUTING_CASES);
    expectPolicyWitnesses(roundTripped, MONACO_ROUTING_CASES);
    expect(stableReports(roundTripReports, MONACO_ROUTING_CASES)).toEqual(
      stableReports(mergedReports, MONACO_ROUTING_CASES),
    );
  });

  it("preserves Monaco routes after a real, PBF-decoded synthetic patch", () => {
    expect({
      nodes: patched.nodes.size,
      ways: patched.ways.size,
      relations: patched.relations.size,
    }).toEqual({ nodes: 14_287, ways: 3_347, relations: 46 });
    expect(patched.nodes.getById(13_000_000_001)).toBeNull();
    expect(patched.ways.getById(3_000_000_001)?.refs).toEqual([7779445520, 13_000_000_002]);
    expectReportsToMatchCases(patchedReports, MONACO_ROUTING_CASES);
    expect(stableRouteBehavior(patchedReports, MONACO_ROUTING_CASES)).toEqual(
      stableRouteBehavior(rawReports, MONACO_ROUTING_CASES),
    );

    expect(canonicalOsmDigest(patchedRoundTripped)).toBe(canonicalOsmDigest(patched));
    expectReportsToMatchCases(patchedRoundTripReports, MONACO_ROUTING_CASES);
    expect(stableReports(patchedRoundTripReports, MONACO_ROUTING_CASES)).toEqual(
      stableReports(patchedReports, MONACO_ROUTING_CASES),
    );
  });
});

describe("routing on a synthetic merged network", () => {
  let merged: Osm;
  let roundTripped: Osm;
  let mergedReports: RoutingCaseReport[];
  let roundTripReports: RoutingCaseReport[];

  beforeAll(async () => {
    merged = await createMergedSyntheticRoutingOsm();
    roundTripped = await fromPbf(await toPbfBuffer(merged), {
      id: "synthetic-merged-roundtrip",
    });
    mergedReports = new RoutingTestHarness(merged).runAll(SYNTHETIC_ROUTING_CASES);
    roundTripReports = new RoutingTestHarness(roundTripped).runAll(SYNTHETIC_ROUTING_CASES);
    const r5OracleDirectory = process.env["OSMIX_ROUTING_ORACLE_DIR"];
    if (r5OracleDirectory) {
      await writeR5OracleArtifacts(
        [
          { id: "synthetic-merged", osm: merged, reports: mergedReports },
          {
            id: "synthetic-merged-roundtrip",
            osm: roundTripped,
            reports: roundTripReports,
          },
        ],
        SYNTHETIC_ROUTING_CASES,
        join(r5OracleDirectory, "synthetic"),
      );
    }
  });

  it("keeps mode-specific paths, one-way direction, and grade separation correct", () => {
    expect(merged.nodes.getById(30)).toBeNull();
    expect(merged.ways.getById(101)?.refs).toEqual([3, 4]);
    expect(merged.relations.getById(200)?.members).toEqual([
      { type: "way", ref: 100, role: "from" },
      { type: "node", ref: 3, role: "via" },
      { type: "way", ref: 101, role: "to" },
    ]);
    expect(merged.nodes.getById(21)).not.toBeNull();
    expect(merged.nodes.getById(23)).not.toBeNull();
    expect(merged.ways.getById(150)?.tags).toMatchObject({
      foot: "designated",
      highway: "residential",
      motor_vehicle: "no",
    });
    const way130 = merged.ways.getById(130)!;
    const way131 = merged.ways.getById(131)!;
    expect(way130.refs.map((ref) => merged.nodes.getNodeLonLat({ id: ref })?.[0])).toEqual([
      0, 0.002, 0.004,
    ]);
    expect(way130.refs.filter((ref) => way131.refs.includes(ref))).toHaveLength(1);

    const reverseWay = merged.ways.getById(140)!;
    expect(reverseWay.refs.map((ref) => merged.nodes.getNodeLonLat({ id: ref })?.[0])).toEqual([
      0.004, 0.003, 0.001, 0,
    ]);
    expectReportsToMatchCases(mergedReports, SYNTHETIC_ROUTING_CASES);
  });

  it("keeps synthetic route behavior stable through a PBF round trip", () => {
    expectReportsToMatchCases(roundTripReports, SYNTHETIC_ROUTING_CASES);
    expect(stableReports(roundTripReports, SYNTHETIC_ROUTING_CASES)).toEqual(
      stableReports(mergedReports, SYNTHETIC_ROUTING_CASES),
    );
  });
});

describe("routing after explicit fuzzy conflation", () => {
  let ordinary: Osm;
  let propertyTransfer: Osm;
  let networkAttachment: Osm;
  let propertyRoundTrip: Osm;
  let attachmentRoundTrip: Osm;
  let ordinaryReports: RoutingCaseReport[];
  let propertyReports: RoutingCaseReport[];
  let attachmentReports: RoutingCaseReport[];
  let propertyRoundTripReports: RoutingCaseReport[];
  let attachmentRoundTripReports: RoutingCaseReport[];

  beforeAll(async () => {
    ({ ordinary, propertyTransfer, networkAttachment } =
      await createSyntheticConflationRoutingVariants());
    [propertyRoundTrip, attachmentRoundTrip] = await Promise.all([
      roundTripRoutingOsm(propertyTransfer, "synthetic-conflation-property-roundtrip"),
      roundTripRoutingOsm(networkAttachment, "synthetic-conflation-attachment-roundtrip"),
    ]);

    ordinaryReports = new RoutingTestHarness(ordinary).runAll(
      SYNTHETIC_CONFLATION_DISCONNECTED_CASES,
    );
    propertyReports = new RoutingTestHarness(propertyTransfer).runAll(
      SYNTHETIC_CONFLATION_DISCONNECTED_CASES,
    );
    attachmentReports = new RoutingTestHarness(networkAttachment).runAll(
      SYNTHETIC_CONFLATION_ATTACHED_CASES,
    );
    propertyRoundTripReports = new RoutingTestHarness(propertyRoundTrip).runAll(
      SYNTHETIC_CONFLATION_DISCONNECTED_CASES,
    );
    attachmentRoundTripReports = new RoutingTestHarness(attachmentRoundTrip).runAll(
      SYNTHETIC_CONFLATION_ATTACHED_CASES,
    );

    const r5OracleDirectory = process.env["OSMIX_ROUTING_ORACLE_DIR"];
    if (r5OracleDirectory) {
      await Promise.all([
        writeR5OracleArtifacts(
          [
            { id: "synthetic-conflation-ordinary", osm: ordinary, reports: ordinaryReports },
            {
              id: "synthetic-conflation-property",
              osm: propertyTransfer,
              reports: propertyReports,
            },
            {
              id: "synthetic-conflation-property-roundtrip",
              osm: propertyRoundTrip,
              reports: propertyRoundTripReports,
            },
          ],
          SYNTHETIC_CONFLATION_DISCONNECTED_CASES,
          join(r5OracleDirectory, "conflation-property"),
        ),
        writeR5OracleArtifacts(
          [
            {
              id: "synthetic-conflation-attachment",
              osm: networkAttachment,
              reports: attachmentReports,
            },
            {
              id: "synthetic-conflation-attachment-roundtrip",
              osm: attachmentRoundTrip,
              reports: attachmentRoundTripReports,
            },
          ],
          SYNTHETIC_CONFLATION_ATTACHED_CASES,
          join(r5OracleDirectory, "conflation-attachment"),
        ),
      ]);
    }
  });

  it("leaves property-only topology and routing unchanged", () => {
    expect(propertyTransfer.nodes.getById(802)?.tags?.["name"]).toBe("Imported endpoint");
    expect(propertyTransfer.nodes.getById(901)?.tags).toMatchObject({
      name: "Imported endpoint",
      source: "synthetic survey",
    });
    expect(propertyTransfer.ways.getById(810)?.refs.at(0)).toBe(801);
    expect(propertyTransfer.ways.getById(849)?.refs.at(-1)).toBe(802);
    expect(propertyTransfer.ways.getById(910)?.refs.at(0)).toBe(901);
    expect(propertyTransfer.ways.getById(949)?.refs.at(-1)).toBe(902);
    expect(topologyFingerprint(propertyTransfer)).toBe(topologyFingerprint(ordinary));
    expectReportsToMatchCases(ordinaryReports, SYNTHETIC_CONFLATION_DISCONNECTED_CASES);
    expectReportsToMatchCases(propertyReports, SYNTHETIC_CONFLATION_DISCONNECTED_CASES);
    expect(stableReports(propertyReports, SYNTHETIC_CONFLATION_DISCONNECTED_CASES)).toEqual(
      stableReports(ordinaryReports, SYNTHETIC_CONFLATION_DISCONNECTED_CASES),
    );
  });

  it("attaches the WALK network while preserving the CAR graph", () => {
    expect(networkAttachment.nodes.getById(802)).toMatchObject({ lon: 0, lat: 0 });
    expect(networkAttachment.ways.getById(810)?.refs.at(0)).toBe(801);
    expect(networkAttachment.ways.getById(849)?.refs.at(-1)).toBe(802);
    expect(networkAttachment.ways.getById(910)?.refs.at(0)).toBe(802);
    expect(networkAttachment.ways.getById(949)?.refs.at(-1)).toBe(902);
    expect(networkAttachment.nodes.getById(901)).not.toBeNull();
    expectReportsToMatchCases(attachmentReports, SYNTHETIC_CONFLATION_ATTACHED_CASES);

    const ordinaryCar = ordinaryReports.find(
      (report) => report.caseId === "synthetic-conflation-car",
    );
    const attachedCar = attachmentReports.find(
      (report) => report.caseId === "synthetic-conflation-car",
    );
    expect(attachedCar?.graph).toEqual(ordinaryCar?.graph);

    const ordinaryWalk = ordinaryReports.find(
      (report) => report.caseId === "synthetic-conflation-walk",
    );
    const attachedWalk = attachmentReports.find(
      (report) => report.caseId === "synthetic-conflation-walk",
    );
    expect(attachedWalk?.graph.edges).toBe(ordinaryWalk?.graph.edges);
    expect(attachedWalk?.graph.weakComponents).toBe(1);
    expect(ordinaryWalk?.graph.weakComponents).toBe(2);
  });

  it("preserves both conflation variants through PBF serialization", () => {
    expect(topologyFingerprint(propertyRoundTrip)).toBe(topologyFingerprint(propertyTransfer));
    expect(topologyFingerprint(attachmentRoundTrip)).toBe(topologyFingerprint(networkAttachment));
    expectReportsToMatchCases(propertyRoundTripReports, SYNTHETIC_CONFLATION_DISCONNECTED_CASES);
    expectReportsToMatchCases(attachmentRoundTripReports, SYNTHETIC_CONFLATION_ATTACHED_CASES);
    expect(
      stableReports(propertyRoundTripReports, SYNTHETIC_CONFLATION_DISCONNECTED_CASES),
    ).toEqual(stableReports(propertyReports, SYNTHETIC_CONFLATION_DISCONNECTED_CASES));
    expect(stableReports(attachmentRoundTripReports, SYNTHETIC_CONFLATION_ATTACHED_CASES)).toEqual(
      stableReports(attachmentReports, SYNTHETIC_CONFLATION_ATTACHED_CASES),
    );
  });
});
