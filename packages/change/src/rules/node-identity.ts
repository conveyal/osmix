/**
 * The one rulebook for "should these two points become one node?". Exact reconciliation
 * (identical coordinates), network connection (nearby, explicit matching) and crossing snaps
 * (a way crossing within 1 m of a vertex) ask the same question with different confidence, so
 * they share every check here and differ only where their kind says so. See MP-M3 and MP-J1 in
 * docs/merge-process.md.
 */
import type { OsmEntity, OsmNode, OsmTags, OsmWay } from "@osmix/types";

import { junctionHasIncompatibleGrades } from "../integrity.ts";
import { accessSignature, barrierSignature } from "./access.ts";
import { refsWouldCollapse } from "./collapse.ts";
import { routingGradeSignature } from "./grade.ts";
import { hasAnyTagConflict } from "./tags.ts";

/**
 * Every kind merges the source's tags into the survivor:
 * - `exact`: identical 7-decimal coordinates.
 * - `connect`: an explicit, nearby network connection.
 * - `crossing`: a crossing within 1 m of an existing vertex.
 */
export type NodeIdentityKind = "exact" | "connect" | "crossing";

export type NodeIdentityReason =
  | "grade-change"
  | "grade-conflict"
  | "routing-family-conflict"
  | "tag-conflict"
  | "would-collapse-way";

export interface NodeIdentityAssessment {
  /** Invariants a decision cannot override. Any hard reason means the points stay separate. */
  hardReasons: NodeIdentityReason[];
  /** Plausible but uncertain; an explicit decision can accept them. */
  reviewReasons: NodeIdentityReason[];
}

/** The survivor's tags after merging an imported point into it: the imported values win. */
export function mergeImportedTags(survivor: OsmTags | undefined, imported: OsmTags | undefined) {
  return { ...survivor, ...imported };
}

/** `survivor` with `imported`'s tags merged in, or `survivor` itself when none change. */
export function withImportedTags<T extends OsmEntity>(
  survivor: T,
  imported: OsmEntity,
  merge = mergeImportedTags,
): T {
  const tags = merge(survivor.tags, imported.tags);
  const same =
    Object.keys(tags).length === Object.keys(survivor.tags ?? {}).length &&
    Object.entries(tags).every(([key, value]) => survivor.tags?.[key] === value);
  return same ? survivor : { ...survivor, tags };
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

/**
 * Node-level checks. When an imported point merges into existing data, the imported values win:
 * they replace conflicting values and may add or change access and barrier tags. Only a change
 * to the survivor's grade needs a person (`grade-change`, a review reason). Within one dataset
 * both sides are existing data, so their tags must agree and their signatures be equal.
 */
export function assessNodeTags(
  source: OsmTags | undefined,
  target: OsmTags | undefined,
  options: { sourceIsImported?: boolean } = {},
): Pick<NodeIdentityAssessment, "hardReasons" | "reviewReasons"> {
  const hardReasons: NodeIdentityReason[] = [];
  const reviewReasons: NodeIdentityReason[] = [];
  if (options.sourceIsImported) {
    if (
      routingGradeSignature(mergeImportedTags(target, source)) !== routingGradeSignature(target)
    ) {
      reviewReasons.push("grade-change");
    }
    return { hardReasons, reviewReasons };
  }
  // Within one dataset, merging must not silently pick one of two existing values.
  if (hasAnyTagConflict(source, target)) hardReasons.push("tag-conflict");
  if (routingGradeSignature(source) !== routingGradeSignature(target)) {
    hardReasons.push("grade-conflict");
  }
  if (
    accessSignature(source) !== accessSignature(target) ||
    barrierSignature(source) !== barrierSignature(target)
  ) {
    hardReasons.push("routing-family-conflict");
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
  options: {
    allowAdjacentDuplicates?: boolean;
    /** Every way already at the target, when it differs from the joinable `targetWays`. */
    junctionWays?: readonly OsmWay[];
  } = {},
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
  if (
    junctionHasIncompatibleGrades(targetId, [...(options.junctionWays ?? targetWays), ...rewritten])
  ) {
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
  options: { sourceIsImported?: boolean } = {},
): NodeIdentityAssessment {
  const { hardReasons, reviewReasons } = assessNodeTags(source.tags, target.tags, options);
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
  };
}

/**
 * The one cleanup rule: after a merge or connection rewrites every reference to `source`, the
 * source goes if it was imported and nothing still uses it. A tagged source goes only when its
 * tags were merged into the survivor, so no value is lost.
 */
export function canDropReplacedNode(input: {
  imported: boolean;
  tagged: boolean;
  tagsMerged: boolean;
  referencedByWay: boolean;
  referencedByRelation: boolean;
}) {
  return (
    input.imported &&
    !input.referencedByWay &&
    !input.referencedByRelation &&
    (input.tagsMerged || !input.tagged)
  );
}
