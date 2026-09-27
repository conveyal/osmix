import { readFileSync } from "node:fs";

import type { Osm } from "@osmix/core";
import { fromPbf } from "@osmix/load";
import { getFixtureFileReadStream, getFixturePath } from "@osmix/test-utils/fixtures";
import {
  type CandidateExpectation,
  MONACO_MERGE_CONFLATION,
  MONACO_MERGE_KNOWN_ISSUES,
  MONACO_MERGE_PATCH,
  MONACO_MERGE_SCENARIOS,
  MONACO_MERGE_STAGES,
  type MergeRun,
  type MergeScenario,
  type StageExpectation,
} from "@osmix/test-utils/monaco-merge-scenarios";
import { beforeAll, describe, expect, it } from "vitest";

import {
  discoverConflationCandidates,
  fromGeoJSON,
  merge,
  type OsmConflationCandidate,
  type OsmConflationDecision,
  type OsmConflationOptions,
} from "../src/index.ts";
import { buildMonacoMergePatch } from "./fixtures/monaco-merge-patch.ts";

const conflation = (overrides: Partial<OsmConflationOptions> = {}): OsmConflationOptions => ({
  ...MONACO_MERGE_CONFLATION,
  propertyKeys: [...MONACO_MERGE_CONFLATION.propertyKeys],
  ...overrides,
});

const committedText = readFileSync(getFixturePath(MONACO_MERGE_PATCH), "utf8");

let base: Osm;
let patch: Osm;

beforeAll(async () => {
  base = await fromPbf(getFixtureFileReadStream("monaco.pbf"), { id: "monaco" });
  patch = await fromGeoJSON(committedText, { id: "monaco-merge-patch" });
});

/** The patch node a candidate expectation names: a feature, or a line's numbered vertex. */
function sourceId(source: CandidateExpectation["source"]): number {
  if (typeof source === "number") return source;
  const way = patch.ways.getById(source.vertexOf);
  const ref = way?.refs[source.index];
  if (ref === undefined) throw Error(`No vertex ${source.index} of patch way ${source.vertexOf}`);
  return ref;
}

function findCandidate(
  candidates: readonly OsmConflationCandidate[],
  expected: CandidateExpectation,
): OsmConflationCandidate | undefined {
  const source = sourceId(expected.source);
  return candidates.find(
    (candidate) =>
      candidate.entityType === expected.entityType &&
      candidate.sourceId === source &&
      candidate.targetId === expected.target,
  );
}

const candidateCases = MONACO_MERGE_SCENARIOS.flatMap((scenario) =>
  scenario.candidates.map((expected) => ({ scenario, expected })),
);

function stageCases(run: MergeRun) {
  return MONACO_MERGE_SCENARIOS.flatMap((scenario) =>
    scenario.stages
      .filter((expected) => !expected.runs || expected.runs.includes(run))
      .map((expected) => ({ scenario, expected })),
  );
}

/** The patch way for a line feature, which the merge may have renumbered vertices of. */
function patchWay(feature: number) {
  const way = patch.ways.getById(feature);
  if (!way) throw Error(`Patch has no way ${feature}`);
  return way;
}

function sharedNodes(merged: Osm, a: number, b: number): number[] {
  const wayA = merged.ways.getById(a);
  const wayB = merged.ways.getById(b);
  if (!wayA || !wayB) throw Error(`Merged result is missing way ${wayA ? b : a}`);
  const refsB = new Set(wayB.refs);
  return [...new Set(wayA.refs.filter((ref) => refsB.has(ref)))];
}

function expectStage(merged: Osm, expected: StageExpectation) {
  switch (expected.kind) {
    case "created":
      expect(
        merged.nodes.getById(expected.feature) ?? merged.ways.getById(expected.feature),
      ).not.toBeNull();
      return;
    case "replaced": {
      const patchNode = patch.nodes.getById(expected.feature);
      if (patchNode) {
        const node = merged.nodes.getById(expected.feature);
        expect(node?.tags).toEqual(patchNode.tags);
        expect([node?.lon, node?.lat]).toEqual([patchNode.lon, patchNode.lat]);
        return;
      }
      const way = merged.ways.getById(expected.feature);
      expect(way?.tags).toEqual(patchWay(expected.feature).tags);
      expect(
        way?.refs.map((ref) => merged.nodes.getById(ref)).map((n) => [n?.lon, n?.lat]),
      ).toEqual(
        patchWay(expected.feature).refs.map((ref) => {
          const node = patch.nodes.getById(ref);
          return [node?.lon, node?.lat];
        }),
      );
      return;
    }
    case "refs-cleaned":
      expect(merged.ways.getById(expected.feature)?.refs).toHaveLength(expected.refs);
      return;
    case "node-reconciled":
      expect(merged.nodes.getById(expected.feature)).toBeNull();
      expect(merged.nodes.getById(expected.baseNode)?.tags).toMatchObject(expected.mergedTags);
      return;
    case "node-kept":
      expect(merged.nodes.getById(expected.feature)).not.toBeNull();
      return;
    case "way-reconciled":
      expect(merged.ways.getById(expected.feature)).toBeNull();
      expect(merged.ways.getById(expected.baseWay)?.tags).toMatchObject(expected.filledTags);
      return;
    case "way-kept":
      expect(merged.ways.getById(expected.feature)).not.toBeNull();
      return;
    case "crossing-added": {
      const shared = sharedNodes(merged, expected.feature, expected.crossedWay);
      expect(shared).toHaveLength(1);
      const node = merged.nodes.getById(shared[0]!);
      expect(base.nodes.getById(shared[0]!)).toBeNull();
      expect(node?.tags?.["crossing"]).toBe("yes");
      return;
    }
    case "vertex-spliced": {
      const shared = sharedNodes(merged, expected.feature, expected.crossedWay);
      expect(shared).toHaveLength(1);
      expect(base.ways.getById(expected.crossedWay)?.refs).toContain(shared[0]);
      return;
    }
    case "not-connected":
      expect(sharedNodes(merged, expected.feature, expected.crossedWay)).toEqual([]);
      return;
    case "tags-copied": {
      const { type, id } = expected.baseEntity;
      const entity = type === "node" ? merged.nodes.getById(id) : merged.ways.getById(id);
      expect(entity?.tags).toMatchObject(expected.tags);
      return;
    }
    case "tags-unchanged": {
      const { type, id } = expected.baseEntity;
      const before = type === "node" ? base.nodes.getById(id) : base.ways.getById(id);
      const after = type === "node" ? merged.nodes.getById(id) : merged.ways.getById(id);
      for (const key of expected.keys) expect(after?.tags?.[key]).toBe(before?.tags?.[key]);
      return;
    }
    case "attached":
      expect(merged.ways.getById(expected.feature)?.refs[expected.index]).toBe(expected.baseNode);
      return;
    case "not-attached":
      expect(merged.ways.getById(expected.feature)?.refs[expected.index]).toBe(
        patchWay(expected.feature).refs[expected.index],
      );
      return;
    case "way-removed": {
      expect(merged.ways.getById(expected.feature)).toBeNull();
      // Removal drops the nodes it leaves unused, and a connection drops the imported vertex it
      // replaces (MP-R1, MP-M2). Either way, no way uses the original vertices.
      const vertices = new Set(patchWay(expected.feature).refs);
      for (const way of merged.ways) {
        expect(
          way.refs.filter((ref) => vertices.has(ref)),
          `way ${way.id}`,
        ).toEqual([]);
      }
      return;
    }
  }
}

function label({ scenario, expected }: { scenario: MergeScenario; expected: { kind?: string } }) {
  return `${scenario.id} ${expected.kind ?? ""}`.trim();
}

describe("Monaco merge-scenario fixture", () => {
  it("matches what the generator builds from the scenarios", () => {
    expect(JSON.parse(committedText)).toEqual(
      JSON.parse(JSON.stringify(buildMonacoMergePatch(base))),
    );
  });

  it("imports every feature under its explicit ID, clear of automatic vertex IDs", () => {
    const features = MONACO_MERGE_SCENARIOS.flatMap((scenario) => scenario.features);
    for (const feature of features) {
      const entity =
        feature.geometry.type === "point"
          ? patch.nodes.getById(feature.id)
          : patch.ways.getById(feature.id);
      expect(entity, `feature ${feature.id}`).not.toBeNull();
    }
    const vertexIds = [...patch.ways].flatMap((way) => way.refs).filter((ref) => ref > -1_000_000);
    const pointIds = features.filter((f) => f.geometry.type === "point").map((f) => f.id);
    expect(vertexIds.filter((ref) => pointIds.includes(ref))).toEqual([]);
  });

  describe("discovery", () => {
    let candidates: readonly OsmConflationCandidate[];
    beforeAll(() => {
      candidates = discoverConflationCandidates(base, patch, conflation()).candidates;
    });

    it.each(candidateCases)("$scenario.id: $expected.entityType candidate", (testCase) => {
      const candidate = findCandidate(candidates, testCase.expected);
      expect(candidate, testCase.scenario.description).toBeDefined();
      expect(candidate?.status).toBe(testCase.expected.status);
      expect(candidate?.reasons.toSorted()).toEqual(testCase.expected.reasons.toSorted());
      const actions = testCase.expected.actions;
      if (actions?.copy) expect(candidate?.propertyTransfer.status).toBe(actions.copy);
      if (actions?.attach) expect(candidate?.networkAttachment?.status).toBe(actions.attach);
      if (actions?.remove) expect(candidate?.wayRemoval?.status).toBe(actions.remove);
    });

    it("reports every automatic candidate as review when automatic actions are off", () => {
      const manual = discoverConflationCandidates(base, patch, conflation({ automatic: "none" }));
      for (const { expected } of candidateCases.filter((c) => c.expected.status === "automatic")) {
        expect(findCandidate(manual.candidates, expected)?.status).toBe("review");
      }
    });
  });

  describe("automatic merge", () => {
    let merged: Osm;
    beforeAll(async () => {
      merged = await merge(base, patch, { ...MONACO_MERGE_STAGES, conflation: conflation() });
    });

    it.each(stageCases("automatic").map((c) => ({ ...c, name: label(c) })))("$name", (c) => {
      expectStage(merged, c.expected);
    });

    it("leaves no untagged imported node that nothing uses", () => {
      const used = new Set<number>();
      for (const way of merged.ways) for (const ref of way.refs) used.add(ref);
      for (const relation of merged.relations)
        for (const member of relation.members) if (member.type === "node") used.add(member.ref);
      const unused = [...merged.nodes].filter(
        (node) => patch.nodes.ids.has(node.id) && !node.tags && !used.has(node.id),
      );
      expect(unused.map((node) => node.id)).toEqual([]);
    });
  });

  describe("reviewed merge", () => {
    let merged: Osm;
    beforeAll(async () => {
      const discovered = discoverConflationCandidates(base, patch, conflation()).candidates;
      const decisions: OsmConflationDecision[] = candidateCases.flatMap(({ expected }) => {
        if (!expected.decision) return [];
        const candidate = findCandidate(discovered, expected);
        if (!candidate) throw Error(`No candidate for ${JSON.stringify(expected.source)}`);
        return [{ candidateId: candidate.id, ...expected.decision }];
      });
      merged = await merge(base, patch, {
        ...MONACO_MERGE_STAGES,
        conflation: conflation({ decisions }),
      });
    });

    it.each(stageCases("reviewed").map((c) => ({ ...c, name: label(c) })))("$name", (c) => {
      expectStage(merged, c.expected);
    });
  });

  // Each known issue merges its scenario on its own; unskip when the bug is fixed.
  describe.each(MONACO_MERGE_KNOWN_ISSUES)("known issue $scenario.id", ({ issue, scenario }) => {
    it.skip(issue, async () => {
      const issuePatch = await fromGeoJSON(
        JSON.stringify(buildMonacoMergePatch(base, [scenario])),
        { id: `monaco-merge-${scenario.id}` },
      );
      const merged = await merge(base, issuePatch, {
        ...MONACO_MERGE_STAGES,
        conflation: conflation(),
      });
      for (const expected of scenario.stages) expectStage(merged, expected);
    });
  });
});
