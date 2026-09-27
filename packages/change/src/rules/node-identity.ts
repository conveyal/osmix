/**
 * The one rulebook for "should these two points become one node?". Exact reconciliation
 * (identical coordinates), network connection (nearby, explicit matching) and crossing snaps
 * (a way crossing within 1 m of a vertex) ask the same question with different confidence, so
 * they share every check here and differ only where their kind says so. See MP-M3 and MP-J1 in
 * docs/merge-process.md.
 */
import type { OsmNode, OsmTags, OsmWay } from "@osmix/types";

import { junctionHasIncompatibleGrades } from "../integrity.ts";
import { accessSignature, barrierSignature } from "./access.ts";
import { refsWouldCollapse } from "./collapse.ts";
import { routingGradeSignature } from "./grade.ts";
import { nodeRoutingSignature } from "./routing.ts";
import { hasAnyTagConflict } from "./tags.ts";

/**
 * - `exact`: identical 7-decimal coordinates; tags merge into the survivor.
 * - `connect`: an explicit, nearby network connection; tags never merge (copying is separate).
 * - `crossing`: a crossing within 1 m of an existing vertex; tags merge into the survivor.
 */
export type NodeIdentityKind = "exact" | "connect" | "crossing";

export type NodeIdentityReason =
  | "grade-conflict"
  | "node-context-conflict"
  | "routing-family-conflict"
  | "tag-conflict"
  | "would-collapse-way";

export interface NodeIdentityAssessment {
  /** Invariants a decision cannot override. Any hard reason means the points stay separate. */
  hardReasons: NodeIdentityReason[];
  /** Plausible but uncertain; an explicit decision can accept them. */
  reviewReasons: NodeIdentityReason[];
  /** Whether the source's tags are merged into the survivor. */
  mergeTags: boolean;
}

const GRADE_KEYS = ["layer", "level", "bridge", "tunnel", "covered"] as const;

/** Whether the survivor absorbs the source's tags for this kind of identity. */
export function mergesTags(kind: NodeIdentityKind) {
  return kind !== "connect";
}

/**
 * Two ways can meet at a shared node only with the same vertical context and the same access,
 * and only if both or neither are highways.
 */
export function wayPairJoinable(a: OsmWay, b: OsmWay) {
  return (
    routingGradeSignature(a.tags) === routingGradeSignature(b.tags) &&
    accessSignature(a.tags) === accessSignature(b.tags) &&
    (a.tags?.["highway"] == null) === (b.tags?.["highway"] == null)
  );
}

/** Node-level checks: the survivor must not gain or lose a routing control or vertical context. */
export function assessNodeTags(
  kind: NodeIdentityKind,
  source: OsmTags | undefined,
  target: OsmTags | undefined,
): Pick<NodeIdentityAssessment, "hardReasons" | "reviewReasons"> {
  const hardReasons: NodeIdentityReason[] = [];
  const reviewReasons: NodeIdentityReason[] = [];
  if (routingGradeSignature(source) !== routingGradeSignature(target)) {
    hardReasons.push("grade-conflict");
  }
  if (accessSignature(source) !== accessSignature(target)) {
    hardReasons.push("routing-family-conflict");
  }
  const sourceBarrier = barrierSignature(source);
  if (sourceBarrier !== barrierSignature(target)) hardReasons.push("routing-family-conflict");
  if (mergesTags(kind)) {
    // Merging tags must not silently pick one of two values.
    if (hasAnyTagConflict(source, target)) hardReasons.push("tag-conflict");
  } else {
    // A connection leaves the source's tags behind, so every node routing control must agree.
    if (nodeRoutingSignature(source) !== nodeRoutingSignature(target)) {
      hardReasons.push("routing-family-conflict");
    }
    if (sourceBarrier !== "") reviewReasons.push("node-context-conflict");
    if (GRADE_KEYS.some((key) => source?.[key] != null || target?.[key] != null)) {
      reviewReasons.push("node-context-conflict");
    }
  }
  return { hardReasons, reviewReasons };
}

/**
 * Way-level checks for joining the source's ways into the target's junction:
 * - each source way needs at least one target way it can join (grade, access, highway);
 * - the whole resulting junction must pass final validation's grade rule, portal exception
 *   included, so discovery and validation cannot disagree;
 * - no rewritten source way may collapse.
 * With no ways on either side there is nothing to join, and the checks pass.
 */
export function assessJunction(
  targetId: number,
  sourceId: number,
  sourceWays: readonly OsmWay[],
  targetWays: readonly OsmWay[],
  options: { allowAdjacentDuplicates?: boolean } = {},
): NodeIdentityReason[] {
  if (sourceWays.length === 0 || targetWays.length === 0) return [];
  const reasons: NodeIdentityReason[] = [];
  if (
    !sourceWays.every((sourceWay) =>
      targetWays.some((targetWay) => wayPairJoinable(sourceWay, targetWay)),
    )
  ) {
    reasons.push("grade-conflict");
  }
  const rewritten = sourceWays.map((way) => ({
    ...way,
    refs: way.refs.map((ref) => (ref === sourceId ? targetId : ref)),
  }));
  if (junctionHasIncompatibleGrades(targetId, [...targetWays, ...rewritten])) {
    reasons.push("grade-conflict");
  }
  for (const way of rewritten) {
    const refs = options.allowAdjacentDuplicates
      ? way.refs.filter((ref, index) => index === 0 || ref !== way.refs[index - 1])
      : way.refs;
    if (way.tags?.["highway"] != null && refsWouldCollapse(refs)) {
      reasons.push("would-collapse-way");
    }
  }
  return reasons;
}

/** Every rule for making `source` and `target` one node. */
export function assessNodeIdentity(
  kind: NodeIdentityKind,
  source: OsmNode,
  target: OsmNode,
  sourceWays: readonly OsmWay[],
  targetWays: readonly OsmWay[],
): NodeIdentityAssessment {
  const { hardReasons, reviewReasons } = assessNodeTags(kind, source.tags, target.tags);
  hardReasons.push(
    ...assessJunction(target.id, source.id, sourceWays, targetWays, {
      // Identical coordinates are the same point: a zero-length segment between two merged
      // vertices is removed, not treated as a collapse.
      allowAdjacentDuplicates: kind === "exact",
    }),
  );
  return {
    hardReasons: [...new Set(hardReasons)],
    reviewReasons: [...new Set(reviewReasons)],
    mergeTags: mergesTags(kind),
  };
}
