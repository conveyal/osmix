/**
 * What a proposal does to tags (T27): the tags of the entity that survives it, before and after,
 * by the rule the planner applies for that kind. It reads the inputs, not the planned state, so
 * a proposal still waiting for a decision says what including it would do.
 */
import type { Osm } from "@osmix/core";
import type { OsmEntity, OsmEntityType, OsmTags } from "@osmix/types";

import { mergeImportedTags } from "../rules/node-identity.ts";
import { withNonConflictingDescriptiveTags } from "../rules/tags.ts";
import type { OsmConflationCandidate } from "../types.ts";
import type { PlanProposal } from "./types.ts";

/** One tag a proposal adds (`before` absent), changes, or removes (`after` absent). */
export interface PlanTagChange {
  key: string;
  before?: string;
  after?: string;
}

/** The tags a proposal changes on the entity that survives it. */
export interface PlanTagChanges {
  /** The entity whose tags change, by planned ID; null when the proposal creates it. */
  entity: { type: OsmEntityType; id: number } | null;
  /** Changed keys, in key order. */
  changes: PlanTagChange[];
  /** How many of its tags stay as they are. */
  unchanged: number;
}

interface TagChangeInputs {
  base: Osm;
  /** The patch with planned IDs. */
  patch: Osm;
  candidate: (candidateId: string) => OsmConflationCandidate | undefined;
}

function entityOf(osm: Osm, type: OsmEntityType, id: number): OsmEntity | null {
  if (type === "node") return osm.nodes.getById(id);
  if (type === "way") return osm.ways.getById(id);
  return osm.relations.getById(id);
}

const stringTags = (tags: OsmTags | undefined) =>
  Object.fromEntries(Object.entries(tags ?? {}).map(([key, value]) => [key, String(value)]));

function diff(
  entity: PlanTagChanges["entity"],
  before: OsmTags | undefined,
  after: OsmTags | undefined,
): PlanTagChanges {
  const from = stringTags(before);
  const to = stringTags(after);
  const changes: PlanTagChange[] = [];
  let unchanged = 0;
  for (const key of [...new Set([...Object.keys(from), ...Object.keys(to)])].sort()) {
    if (from[key] === to[key]) {
      unchanged++;
      continue;
    }
    changes.push({
      key,
      ...(from[key] !== undefined ? { before: from[key] } : {}),
      ...(to[key] !== undefined ? { after: to[key] } : {}),
    });
  }
  return { entity, changes, unchanged };
}

/** The tags every one of `ways` agrees on, which a kept imported way inherits (MP-R2). */
function agreedTags(ways: readonly (OsmEntity | null)[]): OsmTags {
  const [first, ...rest] = ways.map((way) => way?.tags ?? {});
  const agreed: OsmTags = {};
  for (const [key, value] of Object.entries(first ?? {})) {
    if (rest.every((tags) => tags[key] === value)) agreed[key] = value;
  }
  return agreed;
}

/**
 * The tag changes `proposal` makes, or null when it changes no existing tags: an added feature
 * and a connection keep their own. A crossing node is created with `crossing=yes`; a removed
 * imported way's tags go with it.
 */
export function tagChangesOf(
  proposal: PlanProposal,
  { base, patch, candidate }: TagChangeInputs,
): PlanTagChanges | null {
  switch (proposal.kind) {
    case "add":
    case "connect":
      return null;
    case "same-id-replace": {
      const { type, id } = proposal.entity;
      return diff(proposal.entity, entityOf(base, type, id)?.tags, entityOf(patch, type, id)?.tags);
    }
    case "exact-merge": {
      const survivor = entityOf(base, proposal.target.type, proposal.target.id);
      const imported = entityOf(patch, proposal.source.type, proposal.source.id);
      return diff(
        proposal.target,
        survivor?.tags,
        mergeImportedTags(survivor?.tags, imported?.tags),
      );
    }
    case "way-reconcile": {
      const survivor = entityOf(base, "way", proposal.target.id);
      const imported = entityOf(patch, "way", proposal.source.id);
      if (!survivor || !imported) return null;
      return diff(
        proposal.target,
        survivor.tags,
        withNonConflictingDescriptiveTags(survivor, imported).tags,
      );
    }
    case "copy-tags": {
      const tagDiff = candidate(proposal.candidateId)?.evidence.tagDiff ?? [];
      const target = entityOf(base, proposal.target.type, proposal.target.id);
      const after = { ...target?.tags };
      for (const { key, patchValue, protected: isProtected } of tagDiff) {
        if (!isProtected) after[key] = patchValue;
      }
      return diff(proposal.target, target?.tags, after);
    }
    case "remove-way": {
      const imported = entityOf(patch, "way", proposal.source.id);
      return diff(proposal.source, imported?.tags, {});
    }
    case "replace-way": {
      const kept = entityOf(patch, "way", proposal.source.id);
      const replaced = proposal.replaces.map(({ id }) => entityOf(base, "way", id));
      return diff(proposal.source, kept?.tags, { ...agreedTags(replaced), ...kept?.tags });
    }
    case "crossing-node":
      return diff(null, {}, { crossing: "yes" });
    case "crossing-snap": {
      // Two vertices at the crossing become one: the survivor takes the replaced one's tags.
      if (!proposal.merges) return null;
      const node = (id: number) => base.nodes.getById(id) ?? patch.nodes.getById(id);
      const survivor = node(proposal.merges.survivor);
      const replaced = node(proposal.merges.replaced);
      if (!survivor) return null;
      const after = mergeImportedTags(survivor.tags, replaced?.tags);
      // A node where both ways pass through, rather than end, is a crossing (MP-J1).
      const merged = new Set([survivor.id, replaced?.id]);
      const throughBoth = proposal.ways.every(({ id }) => {
        const way = patch.ways.getById(id) ?? base.ways.getById(id);
        return way != null && !merged.has(way.refs[0]) && !merged.has(way.refs.at(-1));
      });
      if (throughBoth && after["crossing"] == null) after["crossing"] = "yes";
      return diff({ type: "node", id: survivor.id }, survivor.tags, after);
    }
  }
}
