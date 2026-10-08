/**
 * Type definitions for OSM changeset operations.
 * @module
 */

import type { OsmEntity, OsmEntityType, OsmEntityTypeMap, OsmTags } from "@osmix/types";

import type { ChangeRecordTable } from "./change-records.ts";

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
 * Pending changes by entity type, keyed by entity ID. An `OsmChangeset` is one. A dropped record
 * reads as no change.
 */
export interface OsmChangeRecords {
  nodeChanges: ChangeRecordTable<OsmEntityTypeMap["node"]>;
  wayChanges: ChangeRecordTable<OsmEntityTypeMap["way"]>;
  relationChanges: ChangeRecordTable<OsmEntityTypeMap["relation"]>;
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
  | "feature-type-conflict"
  | "geometry-mismatch"
  | "grade-change"
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
  | "traces-base-way"
  | "unsupported-way-chain"
  | "way-removal-connection-required"
  | "way-removal-topology-conflict"
  | "way-removal-routing-conflict"
  | "way-removal-relation-member"
  | "way-removal-unsupported"
  | "would-collapse-way";

/** A selected patch tag and the value it would replace on the base entity. */
export interface OsmConflationTagDiff {
  key: string;
  patchValue: string | number;
  baseValue?: string | number;
  protected: boolean;
  routing: boolean;
}

/** Explicit same-key classification disagreement, independent of selected copy keys. */
export interface OsmConflationFeatureTypeConflict {
  key: string;
  baseValue: string | number;
  patchValue: string | number;
}

/** Serializable matching evidence used by the UI and deterministic tests. */
export interface OsmConflationEvidence {
  distanceMeters: number;
  sourceRoutingFamilies: OsmConflationRoutingFamily[];
  targetRoutingFamilies: OsmConflationRoutingFamily[];
  tagDiff: OsmConflationTagDiff[];
  featureTypeConflicts?: OsmConflationFeatureTypeConflict[];
  patchWayIds?: number[];
  bearingDifferenceDegrees?: number;
  /** How far the imported way runs along the target's base way through the source (MP-M1). */
  tracedLengthMeters?: number;
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

/** A retained branch and the explicit node connection needed before removing its trunk. */
export interface OsmConflationWayRemovalConnection {
  sourceNodeId: number;
  targetNodeId: number | null;
  retainedWayIds: number[];
  attachmentCandidateId: string | null;
  explicitlyAccepted: boolean;
}

/** Proposed removal, or actual removal when included in a generated outcome. */
export interface OsmConflationWayRemovalPreview {
  sourceWayId: number;
  retainedWayId: number;
  orphanNodeIds: number[];
  retainedTaggedNodeIds: number[];
  connections: OsmConflationWayRemovalConnection[];
  blockedNodeIds: number[];
  blockingRelationIds: number[];
  /** All original way attributes are discarded unless separately copied. */
  sourceTags: OsmTags;
}

/** Removal is always manually reviewed; it is never an automatic action. */
export interface OsmConflationWayRemovalAssessment extends OsmConflationActionAssessment {
  preview: OsmConflationWayRemovalPreview | null;
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
  wayRemoval?: OsmConflationWayRemovalAssessment;
  /**
   * Node candidates whose connection cannot share this candidate's base node: points of the
   * same imported way (MP-M5). Absent when the connection competes with none.
   */
  connectionRivals?: OsmConflationConnectionRival[];
  evidence: OsmConflationEvidence;
}

/**
 * A connection that cannot share a base node with another (MP-M5): `sharedWayId` names the
 * imported way both points are on, since connecting both would fold it onto one point.
 */
export interface OsmConflationConnectionRival {
  candidateId: string;
  sharedWayId: number;
}

/** Explicit fuzzy-conflation configuration. Property transfer is disabled by an empty key list. */
export interface OsmConflationOptions {
  propertyKeys: string[];
  attachNetwork: boolean;
  /** Enable manual removal review; never selects a removal by itself. */
  allowWayRemoval?: boolean;
  /**
   * Propose replacing base ways with imported ways that trace them (MP-R2): the imported ways
   * are kept and the base ways deleted. Never decided without a person unless the automation
   * level allows it.
   */
  allowWayReplacement?: boolean;
  /** How far apart, in meters, an imported and a base way may be to replace. Defaults to 1. */
  replacementToleranceMeters?: number;
  /**
   * How far, in meters, an imported way must run along a base way for its points not to be
   * connected to that way: it is a copy of the same path (MP-M1). Defaults to 10.
   */
  traceLengthMeters?: number;
  maxDistanceMeters?: number;
  automatic?: OsmConflationAutomatic;
  decisions?: OsmConflationDecision[];
}

/** Fully defaulted options captured with a deterministic discovery result. */
export interface ResolvedOsmConflationOptions {
  propertyKeys: string[];
  attachNetwork: boolean;
  /** Enable manual removal review; never selects a removal by itself. */
  allowWayRemoval?: boolean;
  allowWayReplacement?: boolean;
  /** Present when `allowWayReplacement` is. */
  replacementToleranceMeters?: number;
  traceLengthMeters: number;
  maxDistanceMeters: number;
  automatic: OsmConflationAutomatic;
}

/**
 * A user's explicit choice for a discovered source/target pair.
 * Omitted copy/connect flags select eligible actions. Removal requires explicit true.
 * Selecting no actions skips the match; rejection ignores all action flags.
 */
export interface OsmConflationDecision {
  candidateId: string;
  action: "accept" | "reject";
  transferProperties?: boolean;
  attachNetwork?: boolean;
  /** Explicitly remove the imported way after its topology checks pass. */
  removeWay?: boolean;
}

/** Eligible matching actions scheduled by a decision or automatic discovery defaults. */
export interface OsmConflationResolvedActions {
  transferProperties: boolean;
  attachNetwork: boolean;
  /** Present only when an eligible removal was explicitly selected. */
  removeWay?: boolean;
}

/** A recoverable selection conflict attached to validation errors as `error.conflict`. */
export interface OsmConflationDecisionConflict {
  entityType: OsmConflationEntityType;
  sourceId: number;
  candidateIds: string[];
  message: string;
}

/** Why an imported feature still still needs a matching decision after planning. */
export type OsmConflationUnresolvedKind = "ambiguous" | "blocked" | "unmatched" | "review";

/** Why a present, configured imported tag did not produce a surviving copy. */
export type OsmConflationUncopiedTagReason =
  | "no-accepted-target"
  | "blocked"
  | "not-selected"
  | "protected-tag"
  | "superseded";

/**
 * One imported feature affected by an uncopied configured tag. Empty `reasons` lists are one
 * shared frozen array.
 */
export interface OsmConflationUncopiedTagFeature {
  entityType: OsmConflationEntityType;
  sourceId: number;
  reason: OsmConflationUncopiedTagReason;
  reasons: OsmConflationReasonCode[];
}

/** Per-key outcomes count imported features; absent imported values are excluded. */
export interface OsmConflationTagOutcome {
  key: string;
  presentFeatures: number;
  copiedFeatures: number;
  alreadyEqualFeatures: number;
  /** Final value is present because a different imported source owns the surviving copy. */
  satisfiedByOtherCopyFeatures: number;
  uncopied: OsmConflationUncopiedTagFeature[];
}

/**
 * Actual matching outcome for one source, regardless of its number of alternative candidates.
 * Its empty lists are one shared frozen array: copy a list before changing it.
 */
export interface OsmConflationOutcomeFeature {
  entityType: OsmConflationEntityType;
  sourceId: number;
  candidateIds: string[];
  /** Selected target or sole comparison target; a non-null ID does not imply an applied action. */
  targetId: number | null;
  copiedKeys: string[];
  connectedWayIds: number[];
  wayRemoval?: OsmConflationWayRemovalPreview;
  unresolved: OsmConflationUnresolvedKind | null;
  skipped: boolean;
  /** Whether the imported entity's original ID is present; exact reconciliation can replace that ID. */
  retained: boolean;
  ordinaryAddition: boolean;
  reasons: OsmConflationReasonCode[];
}

/** Actual actions and unique sources. Applied and unresolved counts can overlap for partial success. */
export interface OsmConflationOutcomeSummary {
  features: number;
  appliedFeatures: number;
  tagCopyActions: number;
  copiedTagValues: number;
  networkAttachmentActions: number;
  /** Untagged imported points dropped because a connection left them unused. */
  removedConnectionOrphanNodes: number;
  wayRemovalActions?: number;
  removedOrphanNodes?: number;
  unresolvedFeatures: number;
  ambiguousFeatures: number;
  blockedFeatures: number;
  unmatchedFeatures: number;
  reviewFeatures: number;
  skippedFeatures: number;
  unchangedFeatures: number;
}

/** Literal entity-ID counts, not candidate counts or counts of equivalent geometry. */
export interface OsmConflationEntityCounts {
  nodes: number;
  ways: number;
  relations: number;
}

/** Patch IDs still present, including the subset introduced by ordinary merge rules. */
export interface OsmConflationRetainedImports {
  originalIds: OsmConflationEntityCounts;
  ordinaryAdditions: OsmConflationEntityCounts;
}

/** Detached report comparing the ordinary merge baseline with the generated matching result. */
export interface OsmConflationOutcomeReport {
  /** Evidence after matching; subsequent intersection work can further remap junctions. */
  stage: "matching-before-intersections";
  summary: OsmConflationOutcomeSummary;
  features: OsmConflationOutcomeFeature[];
  tags: OsmConflationTagOutcome[];
  retainedImports: OsmConflationRetainedImports;
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
  /** The same changes counted by change type; the three sum to `totalChanges`. */
  createChanges: number;
  modifyChanges: number;
  deleteChanges: number;
  deduplicatedNodes: number;
  deduplicatedNodesReplaced: number;
  deduplicatedWays: number;
  intersectionPointsFound: number;
  intersectionNodesCreated: number;
  /** Imported points an intersection replaced and left unused, so they were dropped. */
  intersectionNodesRemoved: number;
};
