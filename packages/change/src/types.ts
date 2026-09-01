/**
 * Type definitions for OSM changeset operations.
 * @module
 */

import type { OsmEntity, OsmEntityType, OsmEntityTypeMap } from "@osmix/types";

/**
 * Reference to an OSM entity with its origin dataset.
 * Used to track provenance when merging multiple datasets.
 */
export type OsmEntityRef = {
  type: OsmEntityType;
  id: number;
  osmId: string;
};

/** The type of change being tracked. */
export type OsmChangeTypes = "modify" | "create" | "delete";

/**
 * A single change record for an OSM entity.
 * Tracks the change type, the entity state, origin dataset, and related references.
 *
 * For augmented diffs (see https://wiki.openstreetmap.org/wiki/Overpass_API/Augmented_Diffs),
 * the `oldEntity` field contains the previous state of the entity for "modify" and "delete"
 * operations. This allows consumers to understand what changed between versions.
 */
export type OsmChange<T extends OsmEntity = OsmEntity> = {
  changeType: OsmChangeTypes;
  entity: T;
  osmId: string; // When merging datasets, we need to keep track of the entity's origin dataset.

  /**
   * The previous state of the entity before the change.
   * Present for "modify" and "delete" operations (augmented diffs).
   * Undefined for "create" operations.
   */
  oldEntity?: T;

  // Used to lookup related entities, refs, and relations
  refs?: OsmEntityRef[];
};

/**
 * Options for the high-level `merge()` function.
 * All options default to `false` - enable only the stages you need.
 */
export interface OsmMergeOptions {
  directMerge: boolean;
  deduplicateNodes: boolean;
  deduplicateWays: boolean;
  createIntersections: boolean;

  /** Optional, explicitly configured cross-dataset proximity conflation. */
  conflation?: OsmConflationOptions;
}

/** Entity kinds supported by fuzzy conflation. */
export type OsmConflationEntityType = "node" | "way";

/** Whether high-confidence candidates should be accepted without a review decision. */
export type OsmConflationAutomatic = "high-confidence" | "none";

/** Intrinsic classification of a discovered source/target match. */
export type OsmConflationStatus = "automatic" | "review" | "blocked" | "unmatched";

/** Candidate status after applying an optional user decision. */
export type OsmConflationEffectiveStatus = OsmConflationStatus | "accepted" | "rejected";

/** Stable, machine-readable explanations for a conflation classification. */
export type OsmConflationReasonCode =
  | "bearing-mismatch"
  | "drivable-network"
  | "exact-match"
  | "geometry-mismatch"
  | "grade-conflict"
  | "length-mismatch"
  | "many-to-one"
  | "multiple-targets"
  | "no-transferable-properties"
  | "node-context-conflict"
  | "non-routing-target"
  | "protected-tag"
  | "relation-member"
  | "routing-family-conflict"
  | "routing-property"
  | "same-id"
  | "unsupported-way-chain"
  | "would-collapse-way";

/** A selected patch tag and the value it would replace on the base entity. */
export interface OsmConflationTagDiff {
  key: string;
  patchValue: string | number;
  baseValue?: string | number;
  protected: boolean;
  routing: boolean;
}

/** Serializable matching evidence used by the UI and deterministic tests. */
export interface OsmConflationEvidence {
  distanceMeters: number;
  sourceRoutingFamilies: OsmConflationRoutingFamily[];
  targetRoutingFamilies: OsmConflationRoutingFamily[];
  tagDiff: OsmConflationTagDiff[];
  patchWayIds?: number[];
  bearingDifferenceDegrees?: number;
  endpointDistancesMeters?: [number, number];
  lengthDifferenceRatio?: number;
  maxGeometryDistanceMeters?: number;
}

/** Normalized routing contexts used to compare imported and base geometry. */
export type OsmConflationRoutingFamily =
  | "bicycle-shared"
  | "motor-road"
  | "non-routable"
  | "pedestrian";

/** Classification for one independently selectable conflation action. */
export interface OsmConflationActionAssessment {
  status: OsmConflationStatus;
  reasons: OsmConflationReasonCode[];
}

/** One stable source/target candidate. Ambiguous sources have one row per target. */
export interface OsmConflationCandidate {
  id: string;
  entityType: OsmConflationEntityType;
  sourceId: number;
  targetId: number | null;
  status: OsmConflationStatus;
  reasons: OsmConflationReasonCode[];
  propertyTransfer: OsmConflationActionAssessment;
  networkAttachment: OsmConflationActionAssessment | null;
  evidence: OsmConflationEvidence;
}

/** Explicit fuzzy-conflation configuration. Property transfer is disabled by an empty key list. */
export interface OsmConflationOptions {
  propertyKeys: string[];
  attachNetwork: boolean;
  maxDistanceMeters?: number;
  automatic?: OsmConflationAutomatic;
  decisions?: OsmConflationDecision[];
}

/** Fully defaulted options captured with a deterministic discovery result. */
export interface ResolvedOsmConflationOptions {
  propertyKeys: string[];
  attachNetwork: boolean;
  maxDistanceMeters: number;
  automatic: OsmConflationAutomatic;
}

/** A user's explicit choice for a discovered source/target pair. */
export interface OsmConflationDecision {
  candidateId: string;
  action: "accept" | "reject";
  transferProperties?: boolean;
  attachNetwork?: boolean;
}

/** A filter-wide review operation performed atomically in the conflation worker. */
export type OsmConflationBulkAction = "transfer-properties" | "attach-network" | "reject";

/** Stable input for applying one bulk decision to all candidates matching a filter. */
export interface OsmConflationBulkDecisionRequest {
  action: OsmConflationBulkAction;
  filter: OsmConflationCandidateFilter;
}

/** Counts shown before confirming a filter-wide decision. */
export interface OsmConflationBulkDecisionPreview {
  action: OsmConflationBulkAction;
  filteredCandidates: number;
  eligibleCandidates: number;
  changedCandidates: number;
  skippedCandidates: number;
  automaticCandidates: number;
  reviewCandidates: number;
  overriddenDecisions: number;
}

/** Atomic result returned after a filter-wide decision is applied. */
export interface OsmConflationBulkDecisionResult {
  decisions: OsmConflationDecision[];
  preview: OsmConflationBulkDecisionPreview;
  summary: OsmConflationSummary;
}

/** Counts used to present discovery and review progress. */
export interface OsmConflationSummary {
  total: number;
  accepted: number;
  automatic: number;
  review: number;
  blocked: number;
  unmatched: number;
  rejected: number;
}

/** Deterministic discovery result produced only from untouched inputs. */
export interface OsmConflationDiscovery {
  baseOsmId: string;
  patchOsmId: string;
  options: ResolvedOsmConflationOptions;
  candidates: OsmConflationCandidate[];
  summary: OsmConflationSummary;
}

/** Serializable filters used by paged worker APIs. */
export interface OsmConflationCandidateFilter {
  entityType?: OsmConflationEntityType;
  status?: OsmConflationEffectiveStatus;
  reason?: OsmConflationReasonCode;
  sourceId?: number;
  targetId?: number | null;
}

/**
 * Statistics from a changeset operation.
 * Provides counts of changes and deduplication results.
 */
export type OsmChangesetStats = {
  osmId: string;
  totalChanges: number;
  nodeChanges: number;
  wayChanges: number;
  relationChanges: number;
  deduplicatedNodes: number;
  deduplicatedNodesReplaced: number;
  deduplicatedWays: number;
  intersectionPointsFound: number;
  intersectionNodesCreated: number;
};

/**
 * Serializable representation of all changes in a changeset.
 * Used for JSON export/import of changeset state.
 */
export type OsmChanges = {
  osmId: string;
  nodes: Record<number, OsmChange<OsmEntityTypeMap["node"]>>;
  ways: Record<number, OsmChange<OsmEntityTypeMap["way"]>>;
  relations: Record<number, OsmChange<OsmEntityTypeMap["relation"]>>;
  stats: OsmChangesetStats;
};
