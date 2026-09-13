import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { beforeAll, describe, expect, it } from "vitest";

import { fromPbf, merge, Osm, toPbfBuffer } from "../src/index.ts";
import type { RoutingTestCase } from "./fixtures/routing-cases.ts";
import {
  RoutingTestHarness,
  stableRoutingReport,
  summarizeRoutingVerification,
  writeR5OracleArtifacts,
} from "./routing-harness.ts";

function fixture() {
  const osm = new Osm({ id: "verification-raw" });
  for (const node of [
    { id: 1, lon: 0, lat: 0 },
    { id: 2, lon: 0.001, lat: 0 },
    { id: 3, lon: 0.002, lat: 0 },
    { id: 4, lon: 0.001, lat: 0.001 },
    { id: 101, lon: 0, lat: 0 },
    { id: 102, lon: 0, lat: -0.001 },
  ])
    osm.nodes.addNode(node);
  osm.ways.addWay({ id: 10, refs: [1, 2], tags: { highway: "residential" } });
  osm.ways.addWay({ id: 20, refs: [2, 3], tags: { highway: "residential", motor_vehicle: "no" } });
  osm.ways.addWay({ id: 30, refs: [2, 4, 3], tags: { highway: "residential" } });
  osm.ways.addWay({ id: 40, refs: [101, 102], tags: { highway: "residential" } });
  osm.relations.addRelation({
    id: 100,
    tags: { type: "restriction", restriction: "no_left_turn" },
    members: [
      { type: "way", ref: 10, role: "from" },
      { type: "node", ref: 2, role: "via" },
      { type: "way", ref: 20, role: "to" },
    ],
  });
  osm.buildIndexes();
  osm.buildSpatialIndexes();
  return osm;
}

const accessCase: RoutingTestCase = {
  id: "verified-access-detour",
  description: "The supported test-only car policy excludes the prohibited road",
  mode: "car",
  metric: "distance",
  graphPolicy: "access-aware",
  from: { nodeId: 1 },
  to: { nodeId: 3 },
  expect: {
    reachable: true,
    requiredWayIds: [10, 30],
    forbiddenWayIds: [20],
    forbiddenTransitions: [{ fromWayId: 10, viaNodeId: 2, toWayId: 20 }],
  },
};

const diagnosticCase: RoutingTestCase = {
  ...accessCase,
  id: "unsupported-turn-diagnostic",
  graphPolicy: undefined,
  expect: {},
  policyLimitation: {
    kind: "turn-restriction",
    reason: "The default graph does not interpret turn restrictions or vehicle access tags.",
    r5Expectation: "Exclude the whole directed way pair 10 to 20.",
    witness: {
      type: "relation",
      id: 100,
      tags: { type: "restriction", restriction: "no_left_turn" },
    },
  },
  r5Expect: {
    forbiddenWayIds: [20],
    forbiddenWayTransitions: [{ fromWayId: 10, toWayId: 20 }],
  },
};

describe("routing verification reports", () => {
  let variants: { id: string; osm: Osm; harness: RoutingTestHarness }[];
  beforeAll(async () => {
    const raw = fixture();
    const empty = new Osm({ id: "empty" });
    empty.buildIndexes();
    empty.buildSpatialIndexes();
    const merged = await merge(
      raw,
      empty,
      { directMerge: true, deduplicateNodes: true, deduplicateWays: true },
      () => {},
    );
    const reloaded = await fromPbf(await toPbfBuffer(merged), { id: "verification-reloaded" });
    variants = [raw, merged, reloaded].map((osm, index) => ({
      id: ["raw", "merged", "reloaded"][index]!,
      osm,
      harness: new RoutingTestHarness(osm),
    }));
  });

  describe.each(["raw", "merged", "reloaded"])("%s", (variant) => {
    it("asserts supported reachability and exclusions using stable node and way evidence", () => {
      const report = variants.find((item) => item.id === variant)!.harness.run(accessCase);
      expect(report.verification.status).toBe("passed");
      expect(report.path?.wayIds).toEqual([10, 30]);
      expect(report.path?.edges).toEqual([
        { fromNodeId: 1, toNodeId: 2, wayId: 10 },
        { fromNodeId: 2, toNodeId: 4, wayId: 30 },
        { fromNodeId: 4, toNodeId: 3, wayId: 30 },
      ]);
      expect(report.from).toMatchObject({ nodeId: 1, resolution: "osm-node-id" });
    });

    it("keeps a policy witness diagnostic instead of claiming a passed legality case", () => {
      const harness = variants.find((item) => item.id === variant)!.harness;
      const report = harness.run(diagnosticCase);
      expect(report.path?.wayIds).toEqual([10, 20]);
      expect(report.verification).toMatchObject({
        kind: "policy-diagnostic",
        status: "diagnostic-only",
      });
      expect(report.verification.checks.some((check) => check.routeAssertion)).toBe(false);
      expect(summarizeRoutingVerification([report, harness.run(accessCase)])).toMatchObject({
        assertedCases: 1,
        diagnosticCases: 1,
        passedCases: 1,
        failedCases: 0,
      });
    });

    it("fails declared reachability, way, and turn expectations even with a policy limitation", () => {
      const harness = variants.find((item) => item.id === variant)!.harness;
      const report = harness.run({
        ...diagnosticCase,
        expect: { ...accessCase.expect, reachable: false },
      });
      expect(report.verification.status).toBe("failed");
      expect(
        report.verification.checks
          .filter((check) => check.outcome === "failed")
          .map((check) => check.name),
      ).toEqual([
        "reachability",
        "required-way:30",
        "forbidden-way:20",
        "forbidden-transition:10/2/20",
      ]);
    });

    it("does not count exclusions on an absent route as passed assertions", () => {
      const harness = variants.find((item) => item.id === variant)!.harness;
      const report = harness.run({
        ...diagnosticCase,
        from: { nodeId: 101 },
        expect: { forbiddenWayIds: [20] },
      });
      expect(report.from).not.toBeNull();
      expect(report.to).not.toBeNull();
      expect(report.path).toBeNull();
      expect(report.verification.status).toBe("not-applicable");
      expect(summarizeRoutingVerification([report])).toMatchObject({
        passedCases: 0,
        passedRouteChecks: 0,
        notApplicableRouteChecks: 1,
      });
    });

    it("distinguishes coincident node identities, coordinate selection, and missing endpoints", () => {
      const harness = variants.find((item) => item.id === variant)!.harness;
      const exact = harness.run({
        ...accessCase,
        from: { nodeId: 101 },
        expect: { reachable: false },
      });
      expect(exact.from).toMatchObject({ nodeId: 101, resolution: "osm-node-id" });
      expect(exact.verification.status).toBe("passed");
      expect(summarizeRoutingVerification([exact])).toMatchObject({
        passedRouteChecks: 1,
        unavailableCases: 0,
      });
      const coordinate = harness.run({
        ...accessCase,
        from: { coordinates: [0, 0], maxSnapDistanceMeters: 1 },
      });
      expect(coordinate.from?.resolution).toBe("nearest-routable-node");
      expect([1, 101]).toContain(coordinate.from?.nodeId);
      const missing = harness.run({
        ...accessCase,
        from: { nodeId: 999 },
        expect: { reachable: false },
      });
      expect(stableRoutingReport(missing)).toMatchObject({
        fromNodeId: null,
        fromResolution: "unresolved",
        reachable: false,
        algorithmAgreement: null,
      });
      expect(missing.verification.checks).toContainEqual({
        name: "algorithm-agreement",
        outcome: "not-applicable",
        routeAssertion: false,
      });
      expect(missing.verification.status).toBe("unavailable");
      expect(summarizeRoutingVerification([missing])).toMatchObject({
        passedCases: 0,
        passedRouteChecks: 0,
        unavailableCases: 1,
        unavailableRouteChecks: 1,
      });
    });
  });

  it("exports missing endpoints and separate R5 assertions without claiming Osmix identity in R5", async () => {
    const variant = variants[0]!;
    const cases: RoutingTestCase[] = [
      diagnosticCase,
      {
        ...accessCase,
        id: "missing-node",
        from: { nodeId: 999 },
        expect: { reachable: false },
      },
      {
        ...accessCase,
        id: "outside-coordinates",
        from: { coordinates: [90, 45], maxSnapDistanceMeters: 1 },
        expect: { reachable: false },
      },
    ];
    const reports = variant.harness.runAll(cases);
    const directory = await mkdtemp(join(tmpdir(), "osmix-routing-verification-"));
    try {
      await writeR5OracleArtifacts([{ id: "raw", osm: variant.osm, reports }], cases, directory);
      const [header, ...rows] = (await readFile(join(directory, "routing-cases.tsv"), "utf8"))
        .trimEnd()
        .split("\n")
        .map((row) => row.split("\t"));
      expect(rows).toHaveLength(cases.length);
      const cell = (row: number, name: string) => rows[row]![header!.indexOf(name)];
      expect(cell(0, "expectation_kind")).toBe("policy-diagnostic");
      expect(cell(0, "r5_forbidden_way_ids")).toBe("[20]");
      expect(cell(0, "r5_forbidden_way_transitions")).toBe('[{"fromWayId":10,"toWayId":20}]');
      expect(cell(1, "from_osm_node_id")).toBe("999");
      expect(cell(1, "from_lon")).toBe("");
      expect(cell(1, "from_osmix_resolution")).toBe("unresolved");
      expect(cell(2, "from_lon")).toBe("90");
      expect(cell(2, "from_lat")).toBe("45");
      const matrix = JSON.parse(await readFile(join(directory, "oracle-matrix.json"), "utf8"));
      expect(matrix).toMatchObject({
        schemaVersion: 2,
        datasets: [{ verification: { assertedCases: 2, diagnosticCases: 1 } }],
      });
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });
});
