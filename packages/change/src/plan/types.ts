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

/**
 * How much the planner decides without a person (MP-M6):
 * - `conservative`: every matching action waits for review (`matching.automatic: "none"`).
 * - `recommended`: high-confidence actions apply, and points of one imported way competing for
 *   one base point are settled by the nearest with a clear margin.
 * - `aggressive`: also settles every other choice between candidates the same way, and copies
 *   routing-affecting tags that have no competing choice.
 */
export type MergePlanAutomation = "conservative" | "recommended" | "aggressive";

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
  /** How much the planner decides without a person. Defaults to `recommended`. */
  automation?: MergePlanAutomation;
  /**
   * Decisions a person made on proposals, by proposal ID. The plan is rebuilt with them
   * applied; the automation level never changes them.
   */
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
  "replaced",
  "merged",
  "connected",
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
  /** The decision was made by the automation level, not a person; a person can change it. */
  automated?: true;
  /**
   * Proposals of other kinds that cannot apply together with this one, such as the connections a
   * way replacement makes unnecessary (MP-R2). Accept at most one of this and each excluded.
   */
  excludes?: string[];
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
  /**
   * Other imported features' proposals that cannot apply together with this one: connections
   * to the same base node, or copies and removals against the same base way (MP-M5). Accept
   * at most one of this proposal and its competitors.
   */
  competitors: string[];
}

/**
 * Why a connection competes with another for one base node (MP-M5): both points are on one
 * imported way, named by its patch ID (connecting both would fold it onto one point), or the
 * two together would join different grades there.
 */
export type PlanConnectionRivalry = { sharedWay: number } | { grades: true };

/** A nearby imported point becomes a base point in the network (MP-M3). */
export interface ConnectProposal extends MatchingProposalBase {
  kind: "connect";
  /** Why each competitor cannot apply with this connection, by the competitor's proposal ID. */
  rivalries?: Record<string, PlanConnectionRivalry>;
}

/** Selected tags of an imported feature are copied onto its base match (MP-M2). */
export interface CopyTagsProposal extends MatchingProposalBase {
  kind: "copy-tags";
}

/** An imported way duplicating a base way is removed after its checks pass (MP-R1). */
export interface RemoveWayProposal extends MatchingProposalBase {
  kind: "remove-way";
}

/**
 * An imported way is kept in place of the base ways it traces, which are deleted (MP-R2). The
 * imported ways kept in place of the same base ways are one set: they are decided together.
 */
export interface ReplaceWayProposal extends PlanProposalBase {
  kind: "replace-way";
  /** The imported way kept. Planned ID. */
  source: EntityKey;
  /** The base ways deleted, in chain order. */
  replaces: EntityKey[];
  /** The proposals for the other imported ways kept with this one, decided together. */
  set: string[];
  /** The other imported ways kept with this one, by their patch IDs, in chain order. */
  together: EntityKey[];
}

/** An imported way and a way it crosses share a node at the crossing (MP-J1). */
export interface CrossingProposal extends PlanProposalBase {
  /** `crossing-snap` reuses an existing vertex; `crossing-node` adds a new node. */
  kind: "crossing-snap" | "crossing-node";
  /** The imported way, then the way it crosses. Planned IDs. */
  ways: [EntityKey, EntityKey];
  point: [number, number];
  /** For a snap that makes two vertices one: `replaced` becomes `survivor`. Planned IDs. */
  merges?: { replaced: number; survivor: number };
}

/** A matching action: connect, copy tags or remove a way. */
export type MatchingProposal = ConnectProposal | CopyTagsProposal | RemoveWayProposal;

export type PlanProposal =
  | CrossingProposal
  | AddProposal
  | SameIdReplaceProposal
  | ExactMergeProposal
  | WayReconcileProposal
  | ConnectProposal
  | CopyTagsProposal
  | RemoveWayProposal
  | ReplaceWayProposal;

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
  /** Proposals the automation level decided. */
  automated: number;
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
  diagnostics: {
    /** CAR and WALK routing topology of the base and of the planned result. */
    routing: { car: PlanRoutingDelta; walk: PlanRoutingDelta };
    /** New routing-integrity problems; applying the plan fails while any remain. */
    integrity: string[];
    /** Automatic connections moved to review because they would change the drivable network. */
    demoted: string[];
  };
}

export interface PlanRoutingStats {
  nodes: number;
  routableNodes: number;
  edges: number;
  components: number;
}

export interface PlanRoutingDelta {
  before: PlanRoutingStats;
  after: PlanRoutingStats;
  delta: PlanRoutingStats;
}
