/**
 * Way replacement in a plan (MP-R2): propose keeping imported ways in place of the base ways
 * they trace, decide each set together, leave out what a replacement makes unnecessary, and
 * apply included replacements after matching.
 */
import type { Osm } from "@osmix/core";
import type { OsmRelation } from "@osmix/types";

import type { OsmChangeset } from "../changeset.ts";
import { removeImportedEntity } from "../conflation.ts";
import { assertConflationPreservesBaseTopology } from "../integrity.ts";
import { mergeImportedTags } from "../rules/node-identity.ts";
import { decide } from "./automation.ts";
import { entityToken, proposalEffect, type PlanBuilder } from "./builder.ts";
import { MergePlanDecisionConflictError } from "./decision-conflict.ts";
import type { WayReplacementDiscovery, WayReplacementGroup } from "./replacement.ts";
import type { MergePlanAutomation, PlanProposal, ReplaceWayProposal } from "./types.ts";

/** A group's proposals, one per imported way kept. */
export interface ReplacementProposals {
  group: WayReplacementGroup;
  proposals: ReplaceWayProposal[];
}

/**
 * Propose each group: one `replace-way` per imported way kept, linked as a set. A blocked group's
 * proposals are blocked; a grade change is a reason only a person may decide.
 */
export function proposeWayReplacements(
  builder: PlanBuilder,
  discovery: WayReplacementDiscovery,
): ReplacementProposals[] {
  return discovery.groups.map((group) => {
    const base = group.baseWayIds.map((id) => entityToken("way", id)).join(",");
    const ids = group.importedWayIds.map(
      (id) => `replace:${builder.originalToken("way", id)}>${base}`,
    );
    const proposals = group.importedWayIds.map((wayId, index) => {
      const feature = builder.featureOfWay(wayId);
      if (!feature) throw Error(`Replacement source way ${wayId} is not imported`);
      return builder.propose({
        id: ids[index]!,
        kind: "replace-way",
        feature: feature.key,
        source: { type: "way", id: wayId },
        replaces: group.baseWayIds.map((id) => ({ type: "way", id })),
        set: ids.filter((_, other) => other !== index),
        together: group.importedWayIds
          .filter((_, other) => other !== index)
          .map((id) => ({ type: "way" as const, id: builder.originalId("way", id) })),
        status: group.status,
        reasons: [...group.reasons, ...group.reviewReasons],
      }) as ReplaceWayProposal;
    });
    return { group, proposals };
  });
}

/**
 * Link each replacement to the matching proposals it makes unnecessary, both ways: anything
 * aimed at a replaced way or a released node, connections of the kept ways to the replaced ways'
 * nodes, connections from an imported vertex an anchor takes the place of, and removals of the
 * kept ways (MP-R2). Call again once removals exist; links are added once.
 */
export function linkReplacementExclusions(
  replacements: readonly ReplacementProposals[],
  proposals: ReadonlyMap<string, PlanProposal>,
  wayRefs: (wayId: number) => readonly number[],
) {
  const byTarget = new Map<string, PlanProposal[]>();
  const bySource = new Map<string, PlanProposal[]>();
  for (const proposal of proposals.values()) {
    if (!("candidateId" in proposal)) continue;
    const add = (map: Map<string, PlanProposal[]>, key: string) =>
      map.set(key, [...(map.get(key) ?? []), proposal]);
    add(byTarget, `${proposal.target.type}:${proposal.target.id}`);
    add(bySource, `${proposal.source.type}:${proposal.source.id}`);
  }
  for (const { group, proposals: set } of replacements) {
    const keptNodes = new Set(group.importedWayIds.flatMap(wayRefs));
    const replacedNodes = new Set(group.baseWayIds.flatMap(wayRefs));
    const anchored = new Set(group.anchors.flatMap(({ importedNodeId: id }) => id ?? []));
    const excluded = new Set<PlanProposal>();
    for (const id of group.baseWayIds) {
      for (const proposal of byTarget.get(`way:${id}`) ?? []) excluded.add(proposal);
    }
    for (const id of group.releasedNodeIds) {
      for (const proposal of byTarget.get(`node:${id}`) ?? []) excluded.add(proposal);
    }
    for (const id of keptNodes) {
      for (const proposal of bySource.get(`node:${id}`) ?? []) {
        if (
          proposal.kind === "connect" &&
          (anchored.has(id) || replacedNodes.has(proposal.target.id))
        ) {
          excluded.add(proposal);
        }
      }
    }
    for (const id of group.importedWayIds) {
      for (const proposal of bySource.get(`way:${id}`) ?? []) {
        if (proposal.kind === "remove-way") excluded.add(proposal);
      }
    }
    for (const member of set) {
      for (const other of excluded) {
        member.excludes = [...new Set([...(member.excludes ?? []), other.id])];
        other.excludes = [...new Set([...(other.excludes ?? []), member.id])];
      }
    }
  }
}

/**
 * Decide each set together: a person's decision on any member applies to all, and opposite
 * decisions in one set are a conflict. Without one, the aggressive level includes a set that
 * waits for nothing but consent; a change of grade always waits (MP-M6). Returns the sets that
 * apply.
 */
export function settleReplacementSets(
  replacements: readonly ReplacementProposals[],
  level: MergePlanAutomation,
): ReplacementProposals[] {
  const applied: ReplacementProposals[] = [];
  for (const replacement of replacements) {
    const set = replacement.proposals;
    const decided = set.filter((proposal) => proposal.decision);
    const actions = new Set(decided.map(({ decision }) => decision));
    if (actions.size > 1) {
      const accepted = decided.find(({ decision }) => decision === "accept")!;
      const rejected = decided.find(({ decision }) => decision === "reject")!;
      throw new MergePlanDecisionConflictError(
        `${accepted.id} is included and ${rejected.id} is left out, but the imported ways kept ` +
          `in place of the same base ways are decided together. Include or leave out all of them.`,
        [accepted.id, rejected.id],
      );
    }
    const [action] = actions;
    if (action) {
      for (const proposal of set) {
        proposal.decision = action;
        proposal.effect = proposalEffect(proposal.status, action);
      }
    } else if (
      level === "aggressive" &&
      set.every(({ status, reasons }) => status === "review" && reasons.length === 0)
    ) {
      for (const proposal of set) decide(proposal, "accept");
    }
    if (set.every(({ effect }) => effect === "applied")) applied.push(replacement);
  }
  return applied;
}

/**
 * Leave out what the applied sets exclude, unless a person decided it (a person including both
 * is a conflict the plan reports). The decision follows the set's: automated only when the set's
 * was.
 */
export function leaveOutExcluded(
  applied: readonly ReplacementProposals[],
  proposals: ReadonlyMap<string, PlanProposal>,
) {
  for (const { proposals: set } of applied) {
    const automated = set.some((proposal) => proposal.automated);
    for (const id of new Set(set.flatMap((proposal) => proposal.excludes ?? []))) {
      const other = proposals.get(id);
      if (!other || other.decision || other.status === "blocked") continue;
      if (automated) {
        decide(other, "reject");
        continue;
      }
      other.decision = "reject";
      other.effect = "skipped";
    }
  }
}

/**
 * Apply included replacements after matching: each kept way takes its refs (with the matching
 * connections it kept) and tags, the ways that used a replaced imported vertex use its anchor,
 * anchors take the vertex's tags, relation members move from the replaced ways to the kept ways,
 * and the replaced ways and the base nodes they released are deleted. Then check nothing else
 * of the base changed. `refsBefore` are the kept ways' refs before matching applied.
 */
export function applyWayReplacements(
  changeset: OsmChangeset,
  base: Osm,
  groups: readonly WayReplacementGroup[],
  refsBefore: ReadonlyMap<number, readonly number[]>,
) {
  if (groups.length === 0) return;
  const overlay = changeset.overlay;
  const before = overlay.snapshot();
  const replaced = {
    ways: new Set(groups.flatMap(({ baseWayIds }) => baseWayIds)),
    nodes: new Set<number>(),
    relations: new Set<number>(),
  };
  const relationsOf = new Map<number, number[]>();
  for (const relation of overlay.reader().relations) {
    for (const { type, ref } of relation.members) {
      if (type !== "way" || !replaced.ways.has(ref)) continue;
      relationsOf.set(ref, [...new Set([...(relationsOf.get(ref) ?? []), relation.id])]);
    }
  }
  for (const group of groups) {
    // The imported vertices matching (or an applied neighbour's anchor) replaced with base
    // nodes, from the kept ways' refs.
    const matched = new Map<number, number>();
    for (const id of group.importedWayIds) {
      const previous = refsBefore.get(id);
      const current = overlay.getWay(id)?.refs;
      if (!previous || !current || previous.length !== current.length) {
        throw Error(`Way replacement ${group.id}: an earlier change reshaped kept way ${id}`);
      }
      previous.forEach((ref, index) => {
        if (ref !== current[index]) matched.set(ref, current[index]!);
      });
    }
    // Vertices an anchor takes the place of: every way using them uses the anchor instead.
    const anchorOf = new Map<number, number>();
    for (const { baseNodeId, importedNodeId } of group.anchors) {
      if (importedNodeId != null && importedNodeId !== baseNodeId) {
        anchorOf.set(importedNodeId, baseNodeId);
      }
    }
    for (const [vertex, anchor] of anchorOf) {
      for (const way of overlay.waysAtNode(vertex)) {
        changeset.modify("way", way.id, (current) => ({
          ...current,
          refs: current.refs.map((ref) => (ref === vertex ? anchor : ref)),
        }));
      }
    }
    for (const { wayId, refs } of group.refs) {
      const next = refs.map((ref) => matched.get(ref) ?? ref);
      if (new Set(next).size !== next.length) {
        const repeated = next.find((ref, index) => next.indexOf(ref) !== index);
        const from = refs.filter((ref) => (matched.get(ref) ?? ref) === repeated);
        throw Error(
          `Way replacement ${group.id}: kept way ${wayId} would repeat node ${repeated}, ` +
            `which an earlier change gave to ${from.join(" and ")}`,
        );
      }
      const tags = group.wayTags.find((entry) => entry.wayId === wayId)?.tags;
      changeset.modify("way", wayId, (current) => ({
        ...current,
        refs: next,
        ...(tags ? { tags } : {}),
      }));
    }
    for (const [vertex, anchor] of anchorOf) {
      const imported = overlay.getNode(vertex);
      if (!imported) continue;
      if (Object.keys(imported.tags ?? {}).length > 0) {
        changeset.modify("node", anchor, (current) => ({
          ...current,
          tags: mergeImportedTags(current.tags, imported.tags),
        }));
      }
      if (overlay.waysAtNode(vertex).length === 0) removeImportedEntity(changeset, imported);
    }
    const relations = new Set(group.baseWayIds.flatMap((id) => relationsOf.get(id) ?? []));
    for (const id of relations) {
      moveRelationMembers(changeset, id, group);
      replaced.relations.add(id);
    }
    for (const id of group.baseWayIds) {
      const way = overlay.getWay(id);
      if (way) changeset.delete(way);
    }
    for (const id of group.releasedNodeIds) {
      const node = overlay.getNode(id);
      if (!node || overlay.waysAtNode(id).length > 0) continue;
      changeset.delete(node);
      replaced.nodes.add(id);
    }
  }
  assertConflationPreservesBaseTopology(base, before, overlay, replaced);
}

/**
 * The relation's first member that is a replaced way becomes the kept ways, in chain order and
 * with its role; the other replaced ways' members go.
 */
function moveRelationMembers(
  changeset: OsmChangeset,
  relationId: number,
  group: WayReplacementGroup,
) {
  const replaced = new Set(group.baseWayIds);
  changeset.modify("relation", relationId, (current) => {
    const members: OsmRelation["members"] = [];
    let moved = false;
    for (const member of current.members) {
      if (member.type !== "way" || !replaced.has(member.ref)) {
        members.push(member);
        continue;
      }
      if (moved) continue;
      moved = true;
      for (const ref of group.importedWayIds) {
        members.push({ type: "way", ref, role: member.role });
      }
    }
    return { ...current, members };
  });
}
