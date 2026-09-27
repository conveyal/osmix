/**
 * A merge plan: every change a merge would make, grouped by imported feature, decided before
 * anything is applied. See docs/merge-process.md.
 */
import type { GeoBbox2D, OsmEntityType } from "@osmix/types";

import type {
  OsmConflationOptions,
  OsmConflationOutcomeReport,
  OsmConflationSummary,
} from "../types.ts";

/**
 * How patch IDs are read (the OSM convention by default):
 * - `osm`: negative IDs are new features; positive IDs edit the base entity with that ID.
 * - `new`: every patch entity is a new feature, whatever its ID.
 */
export type PatchIdMode = "osm" | "new";

export interface MergePlanOptions {
  /** How patch IDs are read. Defaults to `osm`. */
  patchIds?: PatchIdMode;
  /**
   * Merge imported points at identical coordinates (and ways that become identical) into the
   * base automatically. When false, those merges wait for a decision. Defaults to true.
   */
  mergeIdenticalPoints?: boolean;
  /**
   * Connect imported paths and roads to the ways they cross at the same grade: at an existing
   * vertex within 1 m, or at a new crossing node. Defaults to true.
   */
  createIntersections?: boolean;
  /**
   * Match imported features to nearby base features (copy tags, connect, remove duplicates).
   * Off unless configured. Decide its proposals with `decisions`, not `matching.decisions`.
   */
  matching?: Omit<OsmConflationOptions, "decisions">;
  /** Decisions on proposals, by proposal ID. The plan is rebuilt with them applied. */
  decisions?: readonly PlanDecision[];
}

export interface PlanDecision {
  proposalId: string;
  action: "accept" | "reject";
}

/** Which dataset a plan was made from, so a stale plan is never applied to other data. */
export interface PlanInputIdentity {
  id: string;
  contentHash: string;
}

export type PlanProposalStatus = "automatic" | "review" | "blocked";

/** What a proposal does in the plan as decided. */
export type PlanProposalEffect = "applied" | "skipped" | "blocked" | "needs-decision";

/** A feature's headline, highest priority first when several proposals touch it. */
export type PlanOutcome =
  | "needs-decision"
  | "removed"
  | "merged"
  | "connected"
  | "replaced"
  | "added"
  | "unchanged";

export const PLAN_OUTCOME_PRIORITY: readonly PlanOutcome[] = [
  "needs-decision",
  "removed",
  "merged",
  "connected",
  "replaced",
  "added",
  "unchanged",
];

interface PlanProposalBase {
  /** Stable across replans and restarts: built from original patch IDs and base IDs. */
  id: string;
  /** The key of the feature this proposal belongs to. */
  feature: string;
  status: PlanProposalStatus;
  reasons: string[];
  decision?: PlanDecision["action"];
  effect: PlanProposalEffect;
}

type EntityKey = { type: OsmEntityType; id: number };

/** A new patch entity is created. Skipped when a merge consumed it instead. */
export interface AddProposal extends PlanProposalBase {
  kind: "add";
  entity: EntityKey;
}

/** A patch entity with a positive ID replaces the base entity with that ID. */
export interface SameIdReplaceProposal extends PlanProposalBase {
  kind: "same-id-replace";
  entity: EntityKey;
}

/** An imported point at a base point's exact coordinate becomes that base point. */
export interface ExactMergeProposal extends PlanProposalBase {
  kind: "exact-merge";
  /** Planned IDs. */
  source: EntityKey;
  target: EntityKey;
}

/** An imported way identical to a base way (after point merges) becomes that base way. */
export interface WayReconcileProposal extends PlanProposalBase {
  kind: "way-reconcile";
  source: EntityKey;
  target: EntityKey;
}

interface MatchingProposalBase extends PlanProposalBase {
  source: EntityKey;
  target: EntityKey;
  /** The matching candidate this action belongs to, for its evidence. */
  candidateId: string;
  /** Proposals of the same kind for the same source: accept at most one. */
  alternatives: string[];
}

/** A nearby imported point becomes a base point in the network (MP-M3). */
export interface ConnectProposal extends MatchingProposalBase {
  kind: "connect";
}

/** Selected tags of an imported feature are copied onto its base match (MP-M2). */
export interface CopyTagsProposal extends MatchingProposalBase {
  kind: "copy-tags";
}

/** An imported way duplicating a base way is removed after its checks pass (MP-R1). */
export interface RemoveWayProposal extends MatchingProposalBase {
  kind: "remove-way";
}

/** An imported way and a way it crosses share a node at the crossing (MP-J1). */
export interface CrossingProposal extends PlanProposalBase {
  /** `crossing-snap` reuses an existing vertex; `crossing-node` adds a new node. */
  kind: "crossing-snap" | "crossing-node";
  /** The imported way, then the way it crosses. Planned IDs. */
  ways: [EntityKey, EntityKey];
  point: [number, number];
}

export type PlanProposal =
  | CrossingProposal
  | AddProposal
  | SameIdReplaceProposal
  | ExactMergeProposal
  | WayReconcileProposal
  | ConnectProposal
  | CopyTagsProposal
  | RemoveWayProposal;

/** One imported feature: a way with its vertices, a standalone node, or a relation. */
export interface PlanFeature {
  /** `<type>:<original patch ID>`, for example `way:-9`. */
  key: string;
  type: OsmEntityType;
  /** The ID in the patch as loaded. */
  originalId: number;
  /** The ID in the plan, after the patch ID remap. */
  id: number;
  /** A way's vertices, as planned IDs. */
  vertexIds?: number[];
  outcome: PlanOutcome;
  proposalIds: string[];
  bbox: GeoBbox2D | null;
}

export interface MergePlanSummary {
  features: Record<PlanOutcome, number>;
  proposals: Record<PlanProposalStatus, number>;
  /** Patch entities whose positive ID names an existing base entity, so they edit it. */
  replacesBase: number;
}

export interface MergePlan {
  version: 1;
  inputs: { base: PlanInputIdentity; patch: PlanInputIdentity };
  options: MergePlanOptions;
  idRemap: { mode: PatchIdMode; remapped: number };
  features: PlanFeature[];
  proposals: Map<string, PlanProposal>;
  summary: MergePlanSummary;
  /** Decisions naming proposals this plan does not have, for example after another decision. */
  staleDecisions: string[];
  /** Present when matching is configured. */
  matching?: { candidates: OsmConflationSummary; outcome: OsmConflationOutcomeReport };
}
