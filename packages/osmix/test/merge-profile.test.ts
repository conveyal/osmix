import { getFixtureFileReadStream, PBFs } from "@osmix/test-utils/fixtures";
import { describe, expect, it } from "vitest";

import { fromPbf, merge, Osm, toPbfBuffer } from "../src/index.ts";
import { canonicalOsmSha256, profileMerge } from "./merge-profile-harness.ts";
import {
  createMonacoRoutingPatch,
  createSyntheticConflationRoutingInputs,
  createSyntheticRoutingBase,
  createSyntheticRoutingPatch,
  roundTripRoutingOsm,
} from "./synthetic-routing-fixture.ts";

const PLAN_STAGES = [
  "plan-direct",
  "plan-identity",
  "plan-matching",
  "plan-crossings",
  "plan-check",
  "apply-plan",
  "fingerprint-canonical-entities",
  "fingerprint-pbf-output",
];

function complete(osm: Osm): Osm {
  osm.buildIndexes();
  osm.buildSpatialIndexes();
  return osm;
}

describe("merge performance harness", () => {
  it("uses a semantic fingerprint that ignores insertion and object-key order", () => {
    const first = new Osm({ id: "first" });
    first.nodes.addNode({ id: 2, lon: 1, lat: 1, tags: { name: "Two", source: "survey" } });
    first.nodes.addNode({ id: 1, lon: 0, lat: 0 });
    first.ways.addWay({ id: 10, refs: [1, 2], tags: { name: "Way", highway: "footway" } });

    const second = new Osm({ id: "second" });
    second.nodes.addNode({ id: 1, lat: 0, lon: 0 });
    second.nodes.addNode({ id: 2, lat: 1, lon: 1, tags: { source: "survey", name: "Two" } });
    second.ways.addWay({ id: 10, refs: [1, 2], tags: { highway: "footway", name: "Way" } });

    expect(canonicalOsmSha256(complete(first))).toBe(canonicalOsmSha256(complete(second)));
    const reversed = new Osm({ id: "reversed" });
    reversed.nodes.addNode({ id: 1, lon: 0, lat: 0 });
    reversed.nodes.addNode({ id: 2, lon: 1, lat: 1, tags: { name: "Two", source: "survey" } });
    reversed.ways.addWay({ id: 10, refs: [2, 1], tags: { highway: "footway", name: "Way" } });
    expect(canonicalOsmSha256(complete(reversed))).not.toBe(canonicalOsmSha256(first));
  });

  it("profiles the same ordered full merge as the public pipeline", async () => {
    const [base, patch] = await Promise.all([
      roundTripRoutingOsm(createSyntheticRoutingBase(), "profile-synthetic-base"),
      roundTripRoutingOsm(createSyntheticRoutingPatch(), "profile-synthetic-patch"),
    ]);
    const report = await profileMerge(base, patch, {});
    const publicResult = await merge(base, patch, {}, () => undefined);

    expect(report.stages.map(({ name }) => name)).toEqual(PLAN_STAGES);
    expect(report.output).toEqual({ nodes: 33, ways: 14, relations: 1 });
    expect(report.fingerprints.contentHash).toBe(publicResult.contentHash());
    expect(report.fingerprints.canonicalSha256).toBe(canonicalOsmSha256(publicResult));
    expect(report.stages.find(({ name }) => name === "plan-identity")?.operations).toMatchObject({
      deduplicatedNodes: 1,
      deduplicatedNodesReplaced: 2,
      deduplicatedWays: 0,
    });
    expect(report.stages.find(({ name }) => name === "plan-crossings")?.operations).toMatchObject({
      intersectionPointsFound: 3,
      intersectionNodesCreated: 3,
      intersectionNodesRemoved: 0,
    });
  });

  it("profiles a plan with matching as the public merge runs it", async () => {
    const { base, patch } = createSyntheticConflationRoutingInputs();
    const options = {
      createIntersections: false,
      matching: {
        propertyKeys: ["name"],
        attachNetwork: true,
        maxDistanceMeters: 1,
        automatic: "high-confidence" as const,
      },
    };
    const report = await profileMerge(base, patch, options);
    const publicResult = await merge(base, patch, options, () => undefined);

    expect(report.stages.map(({ name }) => name)).toEqual(PLAN_STAGES);
    expect(report.fingerprints.contentHash).toBe(publicResult.contentHash());
    expect(report.fingerprints.canonicalSha256).toBe(canonicalOsmSha256(publicResult));
  });

  it("locks Monaco full-merge operations and output fingerprints", async () => {
    const fixture = PBFs["monaco"]!;
    const base = await fromPbf(getFixtureFileReadStream(fixture.url), { id: "profile-monaco" });
    const patch = await fromPbf(await toPbfBuffer(createMonacoRoutingPatch(base)), {
      id: "profile-monaco-patch",
    });
    const report = await profileMerge(base, patch, {});

    expect(report.inputs).toEqual({
      base: { nodes: 14_286, ways: 3_346, relations: 46 },
      patch: { nodes: 2, ways: 1, relations: 0 },
    });
    expect(report.output).toEqual({ nodes: 14_287, ways: 3_347, relations: 46 });
    expect(report.stages.find(({ name }) => name === "plan-identity")?.operations).toMatchObject({
      deduplicatedNodes: 1,
      deduplicatedNodesReplaced: 1,
      deduplicatedWays: 0,
    });
    // One build for the whole merge.
    expect(report.stages.filter(({ name }) => name.startsWith("apply"))).toHaveLength(1);
    // The patch way extends from a base node: a junction, so that node gains no crossing tag.
    expect(report.fingerprints).toMatchObject({
      contentHash: "762396c7",
      canonicalSha256: "07e51056eb80db03ec2786cc2d3c996453a9c0db06d290d31539e0693c5b2cb0",
    });
    // The compressed byte stream can vary with Node's zlib version. Reports keep
    // that useful same-runtime fingerprint, while CI locks semantic output above.
    expect(report.fingerprints.normalizedPbfSha256).toMatch(/^[a-f\d]{64}$/);
    expect(report.fingerprints.pbfBytes).toBeGreaterThan(0);
  }, 30_000);
});
