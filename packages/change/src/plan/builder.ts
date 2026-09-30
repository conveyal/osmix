/**
 * Collects a plan's features and proposals while the phases run, applies decisions to each
 * proposal as it is made, and derives each feature's outcome and the summary at the end.
 */
import type { Osm } from "@osmix/core";
import type { GeoBbox2D, OsmEntityType } from "@osmix/types";

import type { OsmChangeset } from "../changeset.ts";
import { originalId, type PatchIdRemap, remapId } from "./remap.ts";
import {
  type MergePlanOptions,
  type MergePlanSummary,
  PLAN_OUTCOME_PRIORITY,
  type PlanDecision,
  type PlanFeature,
  type PlanOutcome,
  type PlanProposal,
  type PlanProposalEffect,
  type PlanProposalStatus,
} from "./types.ts";

const TYPE_LETTER: Record<OsmEntityType, string> = { node: "n", way: "w", relation: "r" };

/** `n-5`, `w44`: an entity reference that reads the same in every proposal ID. */
export function entityToken(type: OsmEntityType, id: number) {
  return `${TYPE_LETTER[type]}${id}`;
}

const PROPOSAL_OUTCOME: Record<PlanProposal["kind"], PlanOutcome> = {
  add: "added",
  "same-id-replace": "replaced",
  "exact-merge": "merged",
  "way-reconcile": "merged",
  connect: "connected",
  "copy-tags": "merged",
  "remove-way": "removed",
  "crossing-snap": "connected",
  "crossing-node": "connected",
};

/** Planner phases in order. A decision replans from the phase of the proposal it names. */
export const PLAN_PHASES = ["direct", "identity", "matching", "crossings"] as const;
export type PlanPhase = (typeof PLAN_PHASES)[number];

export const PROPOSAL_PHASE: Record<PlanProposal["kind"], PlanPhase> = {
  add: "direct",
  "same-id-replace": "direct",
  "exact-merge": "identity",
  "way-reconcile": "identity",
  connect: "matching",
  "copy-tags": "matching",
  "remove-way": "matching",
  "crossing-snap": "crossings",
  "crossing-node": "crossings",
};

function proposalEffect(
  status: PlanProposalStatus,
  decision: PlanDecision["action"] | undefined,
): PlanProposalEffect {
  if (status === "blocked") return "blocked";
  if (decision === "reject") return "skipped";
  if (status === "automatic" || decision === "accept") return "applied";
  return "needs-decision";
}

/** A proposal as a phase describes it; the builder adds the decision and its effect. */
export type ProposalDraft = PlanProposal extends infer P
  ? P extends PlanProposal
    ? Omit<P, "decision" | "effect">
    : never
  : never;

/** The bounding box of the refs a dataset can resolve; no spatial index needed. */
function refsBbox(osm: Osm, refs: readonly number[]): GeoBbox2D | null {
  let bbox: GeoBbox2D | null = null;
  for (const ref of refs) {
    const node = osm.nodes.getById(ref);
    if (!node) continue;
    if (!bbox) bbox = [node.lon, node.lat, node.lon, node.lat];
    else {
      bbox[0] = Math.min(bbox[0], node.lon);
      bbox[1] = Math.min(bbox[1], node.lat);
      bbox[2] = Math.max(bbox[2], node.lon);
      bbox[3] = Math.max(bbox[3], node.lat);
    }
  }
  return bbox;
}

export class PlanBuilder {
  readonly features: PlanFeature[] = [];
  readonly proposals = new Map<string, PlanProposal>();
  private readonly featuresByKey = new Map<string, PlanFeature>();
  /** Planned node ID to the feature it belongs to: its first way, or itself. */
  private readonly nodeFeatures = new Map<number, PlanFeature>();
  private readonly wayFeatures = new Map<number, PlanFeature>();
  private decisions: Map<string, PlanDecision["action"]>;
  private readonly usedDecisions = new Set<string>();
  private readonly remap: PatchIdRemap;

  constructor(remap: PatchIdRemap, decisions: readonly PlanDecision[] = []) {
    this.remap = remap;
    this.decisions = new Map(decisions.map((decision) => [decision.proposalId, decision.action]));
  }

  /** The patch's ID for a planned ID, for proposal IDs that survive a remap. */
  originalToken(type: OsmEntityType, plannedId: number) {
    return entityToken(type, originalId(this.remap, type, plannedId));
  }

  /** Replace every decision; call `dropFrom` and rerun the affected phases after. */
  setDecisions(decisions: readonly PlanDecision[]) {
    this.decisions = new Map(decisions.map((decision) => [decision.proposalId, decision.action]));
  }

  /** Forget the proposals of `phase` and every later phase, so those phases can run again. */
  dropFrom(phase: PlanPhase) {
    const from = PLAN_PHASES.indexOf(phase);
    const dropped = new Set<string>();
    for (const [id, proposal] of this.proposals) {
      if (PLAN_PHASES.indexOf(PROPOSAL_PHASE[proposal.kind]) < from) continue;
      this.proposals.delete(id);
      this.usedDecisions.delete(id);
      dropped.add(id);
    }
    for (const feature of this.features) {
      feature.proposalIds = feature.proposalIds.filter((id) => !dropped.has(id));
    }
  }

  /** The current decisions, as a list. */
  decisionList(): PlanDecision[] {
    return [...this.decisions].map(([proposalId, action]) => ({ proposalId, action }));
  }

  /** A decision on a proposal the plan has not made yet. */
  decisionFor(proposalId: string) {
    return this.decisions.get(proposalId);
  }

  featureOfNode(plannedId: number) {
    return this.nodeFeatures.get(plannedId);
  }

  featureOfWay(plannedId: number) {
    return this.wayFeatures.get(plannedId);
  }

  /**
   * One feature per patch way (with its vertices), per patch node no patch way uses, and per
   * patch relation, in patch order.
   */
  groupFeatures(patch: Osm) {
    const referencedNodes = new Set<number>();
    for (const way of patch.ways) {
      const id = remapId(this.remap, "way", way.id);
      const feature = this.addFeature({
        key: `way:${way.id}`,
        type: "way",
        originalId: way.id,
        id,
        vertexIds: way.refs.map((ref) => remapId(this.remap, "node", ref)),
        bbox: refsBbox(patch, way.refs),
      });
      this.wayFeatures.set(id, feature);
      for (const ref of way.refs) {
        referencedNodes.add(ref);
        const vertexId = remapId(this.remap, "node", ref);
        if (!this.nodeFeatures.has(vertexId)) this.nodeFeatures.set(vertexId, feature);
      }
    }
    for (const node of patch.nodes) {
      if (referencedNodes.has(node.id)) continue;
      const id = remapId(this.remap, "node", node.id);
      const bbox: GeoBbox2D = [node.lon, node.lat, node.lon, node.lat];
      this.nodeFeatures.set(
        id,
        this.addFeature({ key: `node:${node.id}`, type: "node", originalId: node.id, id, bbox }),
      );
    }
    for (const relation of patch.relations) {
      this.addFeature({
        key: `relation:${relation.id}`,
        type: "relation",
        originalId: relation.id,
        id: remapId(this.remap, "relation", relation.id),
        bbox: null,
      });
    }
  }

  /** Register a proposal with its decision applied, returning what it does. */
  propose(draft: ProposalDraft): PlanProposal {
    // Direct changes are what the patch says; they are not decided one by one.
    const decision =
      PROPOSAL_PHASE[draft.kind] === "direct" ? undefined : this.decisions.get(draft.id);
    if (decision) this.usedDecisions.add(draft.id);
    const proposal = {
      ...draft,
      ...(decision ? { decision } : {}),
      effect: proposalEffect(draft.status, decision),
    } as PlanProposal;
    if (this.proposals.has(proposal.id)) throw Error(`Duplicate plan proposal ${proposal.id}`);
    this.proposals.set(proposal.id, proposal);
    const feature = this.featuresByKey.get(proposal.feature);
    if (!feature) throw Error(`Plan proposal ${proposal.id} names no feature ${proposal.feature}`);
    feature.proposalIds.push(proposal.id);
    return proposal;
  }

  /**
   * Direct proposals from the direct phase's records: `add` for each created entity of the
   * feature, and `same-id-replace` for each base entity a positive patch ID edits. A way's
   * vertices are its own; a vertex that edits a base node is a proposal on its first way.
   */
  proposeDirectChanges(base: Osm, changeset: OsmChangeset) {
    const direct = (featureKey: string, type: OsmEntityType, id: number) => {
      const change = changeset.changes(type)[id];
      if (!change) return;
      const entity = { type, id };
      if (change.changeType === "create") {
        this.propose({
          id: `add:${this.originalToken(type, id)}`,
          kind: "add",
          feature: featureKey,
          entity,
          status: "automatic",
          reasons: [],
        });
      } else {
        this.propose({
          id: `replace:${entityToken(type, id)}`,
          kind: "same-id-replace",
          feature: featureKey,
          entity,
          status: "automatic",
          reasons: [],
        });
      }
    };
    for (const feature of this.features) {
      direct(feature.key, feature.type, feature.id);
      for (const vertexId of feature.vertexIds ?? []) {
        if (!base.nodes.ids.has(vertexId) || this.nodeFeatures.get(vertexId) !== feature) continue;
        direct(feature.key, "node", vertexId);
      }
    }
  }

  /** Outcomes, a summary and stale decisions, once every phase has run. */
  finish(base: Osm, planned: Osm, changeset: OsmChangeset, options: MergePlanOptions) {
    // A created entity a merge consumed is not added after all.
    for (const proposal of this.proposals.values()) {
      if (proposal.kind !== "add") continue;
      const change = changeset.changes(proposal.entity.type)[proposal.entity.id];
      const added = change?.changeType === "create";
      proposal.effect = added ? "applied" : "skipped";
      proposal.reasons = added ? [] : ["merged-into-base"];
    }
    for (const feature of this.features) feature.outcome = this.featureOutcome(feature);
    return {
      summary: this.summarize(base, planned, options),
      staleDecisions: [...this.decisions.keys()].filter((id) => !this.usedDecisions.has(id)),
    };
  }

  private addFeature(feature: Omit<PlanFeature, "outcome" | "proposalIds">) {
    const complete: PlanFeature = { ...feature, outcome: "unchanged", proposalIds: [] };
    this.features.push(complete);
    this.featuresByKey.set(complete.key, complete);
    return complete;
  }

  private featureOutcome(feature: PlanFeature): PlanOutcome {
    let best = PLAN_OUTCOME_PRIORITY.indexOf("unchanged");
    for (const id of feature.proposalIds) {
      const proposal = this.proposals.get(id)!;
      let outcome: PlanOutcome | undefined;
      if (proposal.effect === "needs-decision") outcome = "needs-decision";
      else if (proposal.effect === "applied") outcome = PROPOSAL_OUTCOME[proposal.kind];
      if (outcome) best = Math.min(best, PLAN_OUTCOME_PRIORITY.indexOf(outcome));
    }
    return PLAN_OUTCOME_PRIORITY[best]!;
  }

  private summarize(base: Osm, planned: Osm, options: MergePlanOptions): MergePlanSummary {
    const features = Object.fromEntries(
      PLAN_OUTCOME_PRIORITY.map((outcome) => [outcome, 0]),
    ) as Record<PlanOutcome, number>;
    const summary: MergePlanSummary = {
      features,
      proposals: { automatic: 0, review: 0, blocked: 0 },
      automated: 0,
      replacesBase: 0,
    };
    for (const feature of this.features) summary.features[feature.outcome]++;
    for (const proposal of this.proposals.values()) {
      summary.proposals[proposal.status]++;
      if (proposal.automated) summary.automated++;
    }
    if (options.patchIds === "new") return summary;
    for (const [ids, baseIds] of [
      [planned.nodes.ids, base.nodes.ids],
      [planned.ways.ids, base.ways.ids],
      [planned.relations.ids, base.relations.ids],
    ] as const) {
      for (let index = 0; index < ids.size; index++) {
        const id = ids.at(index);
        if (id > 0 && baseIds.has(id)) summary.replacesBase++;
      }
    }
    return summary;
  }
}
