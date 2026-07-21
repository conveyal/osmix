import { access } from "node:fs/promises";

import type { Osm } from "@osmix/core";
import { getFixtureFileReadStream, getFixturePath } from "@osmix/test-utils/fixtures";
import { describe, expect, it } from "vitest";

import {
  discoverConflationCandidates,
  fromPbf,
  type OsmConflationCandidate,
  type OsmConflationDiscovery,
} from "../src/index.ts";

const BASE_FIXTURE = "yakima-full.osm.pbf";
const PATCH_FIXTURE = "yakima.osw.pbf";
const fixturesExist = await Promise.all(
  [BASE_FIXTURE, PATCH_FIXTURE].map((fixture) =>
    access(getFixturePath(fixture))
      .then(() => true)
      .catch(() => false),
  ),
).then((results) => results.every(Boolean));

function getCandidate(discovery: OsmConflationDiscovery, id: string) {
  const candidate = discovery.candidates.find((item) => item.id === id);
  if (!candidate) throw new Error(`Missing Yakima conflation witness ${id}`);
  return candidate;
}

function getTargetId(candidate: OsmConflationCandidate) {
  if (candidate.targetId == null) throw new Error(`${candidate.id} does not have a target`);
  return candidate.targetId;
}

function getIncidentWays(osm: Osm, nodeId: number) {
  return [...osm.ways].filter((way) => way.refs.includes(nodeId));
}

function expectNonExact(candidate: OsmConflationCandidate, base: Osm, patch: Osm) {
  expect(candidate.targetId).not.toBeNull();
  const source = patch.nodes.getById(candidate.sourceId);
  const target = candidate.targetId == null ? null : base.nodes.getById(candidate.targetId);
  expect(source).not.toBeNull();
  expect(target).not.toBeNull();
  expect([source?.lon, source?.lat]).not.toEqual([target?.lon, target?.lat]);
  expect(candidate.evidence.distanceMeters).toBeGreaterThan(0);
  expect(candidate.evidence.distanceMeters).toBeLessThanOrEqual(1);
}

function expectSchoolBoundaryBlocked(
  discovery: OsmConflationDiscovery,
  base: Osm,
  patch: Osm,
  witness: {
    candidateId: string;
    patchWayId: number;
    schoolName: string;
    targetWayId: number;
  },
) {
  const candidate = getCandidate(discovery, witness.candidateId);
  expectNonExact(candidate, base, patch);
  expect(candidate).toMatchObject({
    entityType: "node",
    status: "blocked",
    networkAttachment: { status: "blocked" },
  });
  expect(candidate.reasons).toContain("non-routing-target");

  const sourceWay = getIncidentWays(patch, candidate.sourceId).find(
    (way) => way.id === witness.patchWayId,
  );
  const targetWay = getIncidentWays(base, getTargetId(candidate)).find(
    (way) => way.id === witness.targetWayId,
  );
  expect(sourceWay?.tags).toMatchObject({ highway: "footway" });
  expect(targetWay?.tags).toMatchObject({ amenity: "school", name: witness.schoolName });
  expect(targetWay?.tags?.["highway"]).toBeUndefined();
  expect(targetWay?.refs[0]).toBe(targetWay?.refs.at(-1));
}

describe("Yakima fuzzy conflation", () => {
  it.runIf(fixturesExist)(
    "classifies real non-exact OSW candidates conservatively",
    async () => {
      const [base, patch] = await Promise.all([
        fromPbf(getFixtureFileReadStream(BASE_FIXTURE), { id: BASE_FIXTURE }),
        fromPbf(getFixtureFileReadStream(PATCH_FIXTURE), { id: PATCH_FIXTURE }),
      ]);
      const discovery = discoverConflationCandidates(base, patch, {
        propertyKeys: ["barrier", "crossing", "kerb", "tactile_paving"],
        attachNetwork: true,
      });

      expect(discovery.options).toEqual({
        propertyKeys: ["barrier", "crossing", "kerb", "tactile_paving"],
        attachNetwork: true,
        maxDistanceMeters: 1,
        automatic: "high-confidence",
      });
      expect(discovery.summary).toEqual({
        total: 11_689,
        automatic: 145,
        review: 212,
        blocked: 88,
        unmatched: 11_244,
        rejected: 0,
      });

      const matched = discovery.candidates.filter((candidate) => candidate.targetId != null);
      const targetCountBySource = new Map<number, number>();
      for (const candidate of matched) {
        targetCountBySource.set(
          candidate.sourceId,
          (targetCountBySource.get(candidate.sourceId) ?? 0) + 1,
        );
      }
      expect(matched).toHaveLength(445);
      expect(targetCountBySource.size).toBe(399);
      expect([...targetCountBySource.values()].filter((count) => count === 1)).toHaveLength(356);
      expect([...targetCountBySource.values()].filter((count) => count > 1)).toHaveLength(43);
      expect(matched.every((candidate) => candidate.evidence.distanceMeters > 0)).toBe(true);

      const accessibleCrossing = getCandidate(discovery, "node:2220318->11643002707");
      expectNonExact(accessibleCrossing, base, patch);
      expect(accessibleCrossing).toMatchObject({
        status: "review",
        reasons: ["node-context-conflict"],
        propertyTransfer: { status: "automatic", reasons: [] },
        networkAttachment: { status: "review", reasons: ["node-context-conflict"] },
        evidence: {
          distanceMeters: 0.40797,
          sourceRoutingFamilies: ["pedestrian"],
          targetRoutingFamilies: ["pedestrian"],
          tagDiff: [
            {
              key: "tactile_paving",
              patchValue: "yes",
              protected: false,
              routing: false,
            },
          ],
        },
      });
      expect(
        getIncidentWays(patch, accessibleCrossing.sourceId).find((way) => way.id === 850268)?.tags,
      ).toMatchObject({ footway: "crossing", highway: "footway" });
      expect(
        getIncidentWays(base, getTargetId(accessibleCrossing)).find(
          (way) => way.id === 1_252_605_649,
        )?.tags,
      ).toMatchObject({ footway: "crossing", highway: "footway" });

      const kerbConflict = getCandidate(discovery, "node:2475012->11643237283");
      expectNonExact(kerbConflict, base, patch);
      expect(kerbConflict).toMatchObject({
        status: "blocked",
        networkAttachment: {
          status: "blocked",
          reasons: expect.arrayContaining(["routing-family-conflict"]),
        },
      });
      expect(patch.nodes.getById(kerbConflict.sourceId)?.tags).toMatchObject({
        barrier: "kerb",
      });
      expect(patch.nodes.getById(kerbConflict.sourceId)?.tags?.["kerb"]).toBeUndefined();
      expect(base.nodes.getById(getTargetId(kerbConflict))?.tags).toMatchObject({
        barrier: "kerb",
        kerb: "raised",
      });

      const sidewalk = getCandidate(discovery, "node:2213758->8075647920");
      expectNonExact(sidewalk, base, patch);
      expect(sidewalk).toMatchObject({
        status: "automatic",
        propertyTransfer: {
          status: "blocked",
          reasons: ["no-transferable-properties"],
        },
        networkAttachment: { status: "automatic", reasons: [] },
      });
      expect(
        getIncidentWays(patch, sidewalk.sourceId).find((way) => way.id === 848575)?.tags,
      ).toMatchObject({ footway: "sidewalk", highway: "footway" });
      expect(
        getIncidentWays(base, getTargetId(sidewalk)).find((way) => way.id === 866_417_077)?.tags,
      ).toMatchObject({ footway: "sidewalk", highway: "footway" });

      expectSchoolBoundaryBlocked(discovery, base, patch, {
        candidateId: "node:2193697->7201121727",
        patchWayId: 840053,
        targetWayId: 771_378_493,
        schoolName: "West Valley High School",
      });
      expectSchoolBoundaryBlocked(discovery, base, patch, {
        candidateId: "node:9412890->9508231896",
        patchWayId: 4_256_164,
        targetWayId: 1_031_701_052,
        schoolName: "White Swan High School",
      });
      expectSchoolBoundaryBlocked(discovery, base, patch, {
        candidateId: "node:9885001->2172323056",
        patchWayId: 4_490_365,
        targetWayId: 207_104_786,
        schoolName: "Terrace Heights Elementary School",
      });
    },
    60_000,
  );
});
