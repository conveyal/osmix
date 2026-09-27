/**
 * A merge plan: every change a merge would make, grouped by imported feature, decided before
 * anything is applied. See docs/merge-process.md.
 */
import type { GeoBbox2D, OsmEntityType } from "@osmix/types";

/**
 * How patch IDs are read (the OSM convention by default):
 * - `osm`: negative IDs are new features; positive IDs edit the base entity with that ID.
 * - `new`: every patch entity is a new feature, whatever its ID.
 */
export type PatchIdMode = "osm" | "new";

export interface MergePlanOptions {
  /** How patch IDs are read. Defaults to `osm`. */
  patchIds?: PatchIdMode;
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
  effect: PlanProposalEffect;
}

/** A new patch entity is created. */
export interface AddProposal extends PlanProposalBase {
  kind: "add";
}

/** A patch entity with a positive ID replaces the base entity with that ID. */
export interface SameIdReplaceProposal extends PlanProposalBase {
  kind: "same-id-replace";
  entity: { type: OsmEntityType; id: number };
}

export type PlanProposal = AddProposal | SameIdReplaceProposal;

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
}
