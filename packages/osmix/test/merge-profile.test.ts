import { getFixtureFileReadStream, PBFs } from "@osmix/test-utils/fixtures";
import { describe, expect, it } from "vitest";

import { fromPbf, merge, Osm, toPbfBuffer } from "../src/index.ts";
import {
  canonicalOsmSha256,
  profileMerge,
  profileWorkerConflation,
} from "./merge-profile-harness.ts";
import {
  createMonacoRoutingPatch,
  createSyntheticConflationRoutingInputs,
  createSyntheticRoutingBase,
  createSyntheticRoutingPatch,
  roundTripRoutingOsm,
} from "./synthetic-routing-fixture.ts";

const ALL_MERGE_STEPS = {
  directMerge: true,
  deduplicateNodes: true,
  deduplicateWays: true,
  createIntersections: true,
} as const;

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
    const report = await profileMerge(base, patch, ALL_MERGE_STEPS);
    const publicResult = await merge(base, patch, ALL_MERGE_STEPS, () => undefined);

    expect(report.stages.map(({ name }) => name)).toEqual([
      "prepare-direct-exact-changeset",
      "generate-direct-changes",
      "reconcile-exact-nodes",
      "reconcile-exact-ways",
      "apply-direct-exact-changes",
      "prepare-intersection-changeset",
      "create-safe-intersections",
      "apply-intersection-changes",
      "fingerprint-canonical-entities",
      "fingerprint-pbf-output",
    ]);
    expect(report.output).toEqual({ nodes: 33, ways: 14, relations: 1 });
    expect(report.fingerprints.contentHash).toBe(publicResult.contentHash());
    expect(report.fingerprints.canonicalSha256).toBe(canonicalOsmSha256(publicResult));
    expect(
      report.stages.find(({ name }) => name === "reconcile-exact-nodes")?.operations,
    ).toMatchObject({ deduplicatedNodes: 1, deduplicatedNodesReplaced: 2 });
    expect(
      report.stages.find(({ name }) => name === "reconcile-exact-ways")?.operations,
    ).toMatchObject({ waysChecked: 7, waysReconciled: 0 });
    expect(
      report.stages.find(({ name }) => name === "create-safe-intersections")?.operations,
    ).toMatchObject({
      waysChecked: 7,
      intersectionPointsFound: 3,
      intersectionNodesCreated: 3,
    });
  });

  it("profiles worker conflation generation with routing safety diagnostics", async () => {
    const { base, patch } = createSyntheticConflationRoutingInputs();
    const report = await profileWorkerConflation(base, patch, {
      directMerge: true,
      deduplicateNodes: true,
      deduplicateWays: true,
      createIntersections: false,
      conflation: {
        propertyKeys: ["name"],
        attachNetwork: true,
        maxDistanceMeters: 1,
        automatic: "high-confidence",
      },
    });

    expect(report.stages.map(({ name }) => name)).toEqual([
      "register-worker-inputs",
      "worker-discover-conflation-candidates",
      "worker-generate-conflation-changeset",
      "worker-apply-conflation-result",
      "fingerprint-canonical-entities",
      "fingerprint-pbf-output",
    ]);
    expect(report.output).toEqual({ nodes: 82, ways: 80, relations: 0 });
    expect(
      report.stages.find(({ name }) => name === "worker-discover-conflation-candidates")
        ?.operations,
    ).toMatchObject({
      candidateTotal: 81,
      candidateAutomatic: 1,
      candidateReview: 0,
      candidateBlocked: 0,
      candidateUnmatched: 80,
    });
    const generation = report.stages.find(
      ({ name }) => name === "worker-generate-conflation-changeset",
    )?.operations;
    expect(generation).toMatchObject({
      totalChanges: 82,
      nodeChanges: 42,
      wayChanges: 40,
      carDeltaRoutableNodes: 0,
      carDeltaEdges: 0,
      carDeltaComponents: 0,
      walkDeltaRoutableNodes: -1,
      walkDeltaComponents: -1,
    });
  });

  it("profiles high-level conflation with the production discovery reuse path", async () => {
    const { base, patch } = createSyntheticConflationRoutingInputs();
    const options = {
      directMerge: true,
      deduplicateNodes: true,
      deduplicateWays: true,
      createIntersections: false,
      conflation: {
        propertyKeys: ["name"],
        attachNetwork: true,
        maxDistanceMeters: 1,
        automatic: "high-confidence" as const,
      },
    };
    const report = await profileMerge(base, patch, options);
    const publicResult = await merge(base, patch, options, () => undefined);

    expect(report.stages.map(({ name }) => name)).toEqual([
      "prepare-direct-exact-changeset",
      "generate-direct-changes",
      "reconcile-exact-nodes",
      "reconcile-exact-ways",
      "apply-direct-exact-changes",
      "discover-conflation-candidates",
      "generate-conflation-changes",
      "apply-conflation-changes",
      "fingerprint-canonical-entities",
      "fingerprint-pbf-output",
    ]);
    expect(report.fingerprints.contentHash).toBe(publicResult.contentHash());
    expect(report.fingerprints.canonicalSha256).toBe(canonicalOsmSha256(publicResult));
  });

  it("locks Monaco full-merge operations and output fingerprints", async () => {
    const fixture = PBFs["monaco"]!;
    const base = await fromPbf(getFixtureFileReadStream(fixture.url), { id: "profile-monaco" });
    const patch = await fromPbf(await toPbfBuffer(createMonacoRoutingPatch(base)), {
      id: "profile-monaco-patch",
    });
    const report = await profileMerge(base, patch, ALL_MERGE_STEPS);

    expect(report.inputs).toEqual({
      base: { nodes: 14_286, ways: 3_346, relations: 46 },
      patch: { nodes: 2, ways: 1, relations: 0 },
    });
    expect(report.output).toEqual({ nodes: 14_287, ways: 3_347, relations: 46 });
    expect(
      report.stages.find(({ name }) => name === "reconcile-exact-nodes")?.operations,
    ).toMatchObject({ deduplicatedNodes: 1, deduplicatedNodesReplaced: 1 });
    expect(
      report.stages.find(({ name }) => name === "reconcile-exact-ways")?.operations,
    ).toMatchObject({ waysChecked: 1, waysReconciled: 0 });
    expect(
      report.stages.find(({ name }) => name === "create-safe-intersections")?.operations,
    ).toMatchObject({ waysChecked: 1 });
    expect(report.fingerprints).toMatchObject({
      contentHash: "c941a5b8",
      canonicalSha256: "4f47037cf117c361dfc36113a7734eebd37b0f4a9e4d84861dc0ca5e3527ea5d",
    });
    // The compressed byte stream can vary with Node's zlib version. Reports keep
    // that useful same-runtime fingerprint, while CI locks semantic output above.
    expect(report.fingerprints.normalizedPbfSha256).toMatch(/^[a-f\d]{64}$/);
    expect(report.fingerprints.pbfBytes).toBeGreaterThan(0);
  }, 30_000);
});
