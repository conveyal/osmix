import { Nodes, type NodeSpatialIndexKind, type Osm } from "@osmix/core";

const MIB = 2 ** 20;
const GIB = 2 ** 30;

export const OSM_LOAD_PROFILES = ["auto", "full", "view"] as const;

export type OsmLoadProfile = (typeof OSM_LOAD_PROFILES)[number];
export type ResolvedOsmLoadProfile = Exclude<OsmLoadProfile, "auto">;

export interface OsmSpatialIndexSelection {
  nodes: NodeSpatialIndexKind[];
  ways: boolean;
  relations: boolean;
}

export interface OsmLoadCapabilities {
  /** Approximate physical device memory reported by the runtime. */
  deviceMemoryBytes?: number;
  /** Largest successfully allocated ArrayBuffer in an isolated probe worker. */
  arrayBufferMaxBytes?: number;
  /** Largest successfully allocated SharedArrayBuffer in an isolated probe worker. */
  sharedArrayBufferMaxBytes?: number;
  /** Buffer implementation used by core typed arrays in the loading runtime. */
  activeBufferType?: "array-buffer" | "shared-array-buffer";
}

export interface OsmLoadProjection {
  entityCounts: {
    nodes: number;
    ways: number;
    relations: number;
    taggedNodes: number;
  };
  currentTypedArrayBytes: number;
  allNodeSpatialIndexBytes: number;
  taggedNodeSpatialIndexBytes: number;
  waySpatialIndexBytes: number;
  relationSpatialIndexBytes: number;
  /** Full-profile values retained for Auto's Full eligibility checks. */
  largestPlannedAllocationBytes: number;
  projectedTypedArrayPeakBytes: number;
  profilePeaks: Record<ResolvedOsmLoadProfile, OsmLoadProfilePeak>;
  plannedAllocations: {
    allNodeSpatialIndex: number;
    taggedNodeSpatialIndex: number;
    wayTree: number;
    wayBboxCapacity: number;
    wayBbox: number;
    relationTree: number;
    relationBboxCapacity: number;
    relationBbox: number;
  };
}

export interface OsmLoadProfilePeak {
  largestPlannedAllocationBytes: number;
  projectedTypedArrayPeakBytes: number;
}

export type OsmLoadDiagnosticCode =
  | "explicit-profile"
  | "explicit-spatial-index-selection"
  | "all-node-index-limit"
  | "typed-array-peak-limit"
  | "selected-typed-array-peak-limit"
  | "single-allocation-limit"
  | "within-auto-limits";

export interface OsmLoadDiagnostic {
  code: OsmLoadDiagnosticCode;
  level: "info" | "warning";
  message: string;
}

export interface OsmLoadDecision {
  requestedProfile: OsmLoadProfile;
  resolvedProfile: ResolvedOsmLoadProfile;
  spatialIndexes: OsmSpatialIndexSelection;
  projection: OsmLoadProjection;
  /** Peak projection for the indexes that will actually be built. */
  selectedPeak: OsmLoadProfilePeak;
  capabilities: OsmLoadCapabilities;
  limits: {
    allNodeSpatialIndexBytes: number;
    projectedTypedArrayPeakBytes: number;
    largestPlannedAllocationBytes?: number;
  };
  diagnostics: OsmLoadDiagnostic[];
}

/** Structured preflight failure that survives worker error serialization. */
export class OsmLoadCapacityError extends Error {
  readonly code = "OSM_LOAD_CAPACITY_EXCEEDED";
  readonly stage = "spatial-index-preflight";
  readonly requestedProfile: OsmLoadProfile;
  readonly resolvedProfile: ResolvedOsmLoadProfile;
  readonly requiredBytes: number;
  /** Active allocation budget after reserving 20% headroom. */
  readonly availableBytes: number;
  readonly spatialIndexes: OsmSpatialIndexSelection;
  /** A lower-memory profile that satisfies the same tested allocation limit. */
  readonly suggestedProfile?: "view";

  constructor(args: {
    requestedProfile: OsmLoadProfile;
    resolvedProfile: ResolvedOsmLoadProfile;
    requiredBytes: number;
    availableBytes: number;
    spatialIndexes: OsmSpatialIndexSelection;
    suggestedProfile?: "view";
  }) {
    super(
      `The largest ${args.resolvedProfile} profile allocation requires ${formatMib(args.requiredBytes)}, exceeding the active-buffer safety limit of ${formatMib(args.availableBytes)}.`,
    );
    this.name = "OsmLoadCapacityError";
    this.requestedProfile = args.requestedProfile;
    this.resolvedProfile = args.resolvedProfile;
    this.requiredBytes = args.requiredBytes;
    this.availableBytes = args.availableBytes;
    this.spatialIndexes = normalizeOsmSpatialIndexSelection(args.spatialIndexes);
    this.suggestedProfile = args.suggestedProfile;
  }
}

/** Structured index-construction failure with enough context for actionable UI. */
export class OsmSpatialIndexBuildError extends Error {
  readonly code = "OSM_SPATIAL_INDEX_BUILD_FAILED";
  readonly stage = "spatial-index-build";
  readonly entityType: "node" | "way" | "relation";
  readonly indexKind?: NodeSpatialIndexKind;

  constructor(
    entityType: "node" | "way" | "relation",
    indexKind: NodeSpatialIndexKind | undefined,
    cause: unknown,
  ) {
    const detail = cause instanceof Error ? cause.message : String(cause);
    super(
      `Failed to build ${indexKind ? `${indexKind} node` : entityType} spatial index: ${detail}`,
      { cause },
    );
    this.name = "OsmSpatialIndexBuildError";
    this.entityType = entityType;
    this.indexKind = indexKind;
  }
}

export const FULL_SPATIAL_INDEX_SELECTION: OsmSpatialIndexSelection = {
  nodes: ["tagged", "all"],
  ways: true,
  relations: true,
};

export const VIEW_SPATIAL_INDEX_SELECTION: OsmSpatialIndexSelection = {
  nodes: ["tagged"],
  ways: true,
  relations: true,
};

export function normalizeOsmSpatialIndexSelection(
  selection: OsmSpatialIndexSelection,
): OsmSpatialIndexSelection {
  return {
    nodes: Array.from(new Set(selection.nodes)),
    ways: selection.ways,
    relations: selection.relations,
  };
}

const ALL_NODE_SPATIAL_INDEX_LIMIT = 256 * MIB;
const ABSOLUTE_TYPED_ARRAY_PEAK_LIMIT = 4 * GIB;
const DEVICE_MEMORY_FRACTION = 0.4;
const BUFFER_HEADROOM_FRACTION = 0.8;

function flatbushNodeCount(count: number, nodeSize = 128): number {
  if (count === 0) return 0;
  let nodes = count;
  let levelNodes = count;
  while (levelNodes !== 1) {
    levelNodes = Math.ceil(levelNodes / nodeSize);
    nodes += levelNodes;
  }
  return nodes;
}

function flatbushBytes(count: number): number {
  const nodes = flatbushNodeCount(count);
  if (nodes === 0) return 0;
  const indexBytes = nodes * (nodes < 16_384 ? Uint16Array.BYTES_PER_ELEMENT : 4);
  const boxesBytes = nodes * 4 * Float64Array.BYTES_PER_ELEMENT;
  return 8 + indexBytes + boxesBytes;
}

function nextPowerOfTwoBytes(bytes: number): number {
  if (bytes <= MIB) return MIB;
  return 2 ** Math.ceil(Math.log2(bytes));
}

function collectUniqueBuffers(value: unknown, buffers: Set<ArrayBufferLike>): void {
  if (
    value instanceof ArrayBuffer ||
    (typeof SharedArrayBuffer !== "undefined" && value instanceof SharedArrayBuffer)
  ) {
    buffers.add(value);
  } else if (value !== null && typeof value === "object") {
    for (const child of Object.values(value)) collectUniqueBuffers(child, buffers);
  }
}

function collectUniqueBufferBytes(value: unknown): number {
  const buffers = new Set<ArrayBufferLike>();
  collectUniqueBuffers(value, buffers);
  let total = 0;
  for (const buffer of buffers) total += buffer.byteLength;
  return total;
}

/** Count unique typed-array backing buffers currently retained by an Osm dataset. */
export function getOsmTypedBufferBytes(osm: Osm): number {
  return collectUniqueBufferBytes(osm.transferables());
}

/** Exact IndexedDB payload bytes when rebuildable spatial indexes are omitted. */
export function getOsmStorableBufferBytes(osm: Osm): number {
  const transferables = osm.transferables();
  const {
    allSpatialIndex: _allSpatialIndex,
    taggedSpatialIndex: _taggedSpatialIndex,
    ...nodes
  } = transferables.nodes;
  const { spatialIndex: _waySpatialIndex, ...ways } = transferables.ways;
  const { spatialIndex: _relationSpatialIndex, ...relations } = transferables.relations;
  return collectUniqueBufferBytes({
    stringTable: transferables.stringTable,
    nodes,
    ways,
    relations,
  });
}

/**
 * Project the typed-array footprint of building the Full spatial-index profile.
 *
 * The projection deliberately starts from the buffers already owned by `osm`,
 * deduplicating aliased buffers, then adds spatial allocations that have not yet
 * been built. Way and relation bbox compaction peaks include both the growable
 * power-of-two buffer and its fixed-size replacement.
 */
export function projectOsmLoad(osm: Osm): OsmLoadProjection {
  const nodes = osm.nodes.size;
  const taggedNodes = osm.nodes.taggedSize;
  const ways = osm.ways.size;
  const relations = osm.relations.size;
  const currentTypedArrayBytes = getOsmTypedBufferBytes(osm);
  const allNodeSpatialIndexBytes = Nodes.getSpatialIndexBytesRequired(nodes);
  const taggedNodeSpatialIndexBytes = Nodes.getSpatialIndexBytesRequired(taggedNodes);
  const wayTreeBytes = flatbushBytes(ways);
  const relationTreeBytes = flatbushBytes(relations);
  const wayBboxBytes = ways * 4 * Float64Array.BYTES_PER_ELEMENT;
  const relationBboxBytes = relations * 4 * Float64Array.BYTES_PER_ELEMENT;
  const wayBboxCapacityBytes = nextPowerOfTwoBytes(wayBboxBytes);
  const relationBboxCapacityBytes = nextPowerOfTwoBytes(relationBboxBytes);
  const plannedAllocations = {
    allNodeSpatialIndex: allNodeSpatialIndexBytes,
    taggedNodeSpatialIndex: taggedNodeSpatialIndexBytes,
    wayTree: wayTreeBytes,
    wayBboxCapacity: wayBboxCapacityBytes,
    wayBbox: wayBboxBytes,
    relationTree: relationTreeBytes,
    relationBboxCapacity: relationBboxCapacityBytes,
    relationBbox: relationBboxBytes,
  };
  const baseProjection = {
    currentTypedArrayBytes,
    plannedAllocations,
  };
  const profilePeaks = {
    full: projectSelectionPeak(baseProjection, FULL_SPATIAL_INDEX_SELECTION),
    view: projectSelectionPeak(baseProjection, VIEW_SPATIAL_INDEX_SELECTION),
  };

  return {
    entityCounts: { nodes, ways, relations, taggedNodes },
    currentTypedArrayBytes,
    allNodeSpatialIndexBytes,
    taggedNodeSpatialIndexBytes,
    waySpatialIndexBytes: wayTreeBytes + wayBboxBytes,
    relationSpatialIndexBytes: relationTreeBytes + relationBboxBytes,
    largestPlannedAllocationBytes: profilePeaks.full.largestPlannedAllocationBytes,
    projectedTypedArrayPeakBytes: profilePeaks.full.projectedTypedArrayPeakBytes,
    profilePeaks,
    plannedAllocations,
  };
}

function projectSelectionPeak(
  projection: Pick<OsmLoadProjection, "currentTypedArrayBytes" | "plannedAllocations">,
  selection: OsmSpatialIndexSelection,
): OsmLoadProfilePeak {
  const normalized = normalizeOsmSpatialIndexSelection(selection);
  const allocations = projection.plannedAllocations;
  const nodeBytes =
    (normalized.nodes.includes("all") ? allocations.allNodeSpatialIndex : 0) +
    (normalized.nodes.includes("tagged") ? allocations.taggedNodeSpatialIndex : 0);
  const afterNodes = projection.currentTypedArrayBytes + nodeBytes;
  const wayBuildPeak = normalized.ways
    ? afterNodes + allocations.wayTree + allocations.wayBboxCapacity + allocations.wayBbox
    : afterNodes;
  const afterWays = normalized.ways
    ? afterNodes + allocations.wayTree + allocations.wayBbox
    : afterNodes;
  const relationBuildPeak = normalized.relations
    ? afterWays +
      allocations.relationTree +
      allocations.relationBboxCapacity +
      allocations.relationBbox
    : afterWays;
  const individualAllocations = [
    normalized.nodes.includes("all") ? allocations.allNodeSpatialIndex : 0,
    normalized.nodes.includes("tagged") ? allocations.taggedNodeSpatialIndex : 0,
    normalized.ways ? allocations.wayTree : 0,
    normalized.ways ? allocations.wayBboxCapacity : 0,
    normalized.relations ? allocations.relationTree : 0,
    normalized.relations ? allocations.relationBboxCapacity : 0,
  ];
  return {
    largestPlannedAllocationBytes: Math.max(...individualAllocations),
    projectedTypedArrayPeakBytes: Math.max(afterNodes, wayBuildPeak, relationBuildPeak),
  };
}

function activeBufferCeiling(capabilities: OsmLoadCapabilities): number | undefined {
  if (capabilities.activeBufferType === "shared-array-buffer") {
    return capabilities.sharedArrayBufferMaxBytes;
  }
  if (capabilities.activeBufferType === "array-buffer") {
    return capabilities.arrayBufferMaxBytes;
  }
  return capabilities.sharedArrayBufferMaxBytes ?? capabilities.arrayBufferMaxBytes;
}

function formatMib(bytes: number): string {
  return `${(bytes / MIB).toFixed(0)} MiB`;
}

interface OsmLoadLimits {
  typedPeakLimit: number;
  allocationLimit?: number;
}

/** Derive this runtime's advisory peak and hard single-allocation limits. */
function computeOsmLoadLimits(capabilities: OsmLoadCapabilities): OsmLoadLimits {
  const devicePeakLimit = capabilities.deviceMemoryBytes
    ? capabilities.deviceMemoryBytes * DEVICE_MEMORY_FRACTION
    : Number.POSITIVE_INFINITY;
  const typedPeakLimit = Math.min(ABSOLUTE_TYPED_ARRAY_PEAK_LIMIT, devicePeakLimit);
  const bufferCeiling = activeBufferCeiling(capabilities);
  // A measured ceiling of 0 is a real (empty) budget, not an unknown one; only
  // an unmeasured runtime skips the hard single-allocation check.
  const allocationLimit =
    bufferCeiling !== undefined ? bufferCeiling * BUFFER_HEADROOM_FRACTION : undefined;
  return { typedPeakLimit, allocationLimit };
}

/**
 * Apply the selected-peak warning and hard single-allocation budget shared by
 * profile-based and explicit-selection decisions, then assemble the decision.
 * Throws `OsmLoadCapacityError` when the largest planned allocation cannot fit
 * the tested active-buffer budget.
 */
function finalizeOsmLoadDecision(args: {
  requestedProfile: OsmLoadProfile;
  resolvedProfile: ResolvedOsmLoadProfile;
  spatialIndexes: OsmSpatialIndexSelection;
  /** Subject used in the selected-peak warning, e.g. "the selected Full profile". */
  peakWarningSubject: string;
  selectedPeak: OsmLoadProfilePeak;
  projection: OsmLoadProjection;
  capabilities: OsmLoadCapabilities;
  limits: OsmLoadLimits;
  diagnostics: OsmLoadDiagnostic[];
}): OsmLoadDecision {
  const { typedPeakLimit, allocationLimit } = args.limits;
  const { selectedPeak, spatialIndexes, resolvedProfile, diagnostics } = args;
  if (selectedPeak.projectedTypedArrayPeakBytes > typedPeakLimit) {
    diagnostics.push({
      code: "selected-typed-array-peak-limit",
      level: "warning",
      message: `${args.peakWarningSubject} may peak at ${formatMib(selectedPeak.projectedTypedArrayPeakBytes)}, above the ${formatMib(typedPeakLimit)} working-set guideline. The load will still be attempted.`,
    });
  }
  if (
    allocationLimit !== undefined &&
    selectedPeak.largestPlannedAllocationBytes > allocationLimit
  ) {
    throw new OsmLoadCapacityError({
      requestedProfile: args.requestedProfile,
      resolvedProfile,
      requiredBytes: selectedPeak.largestPlannedAllocationBytes,
      availableBytes: allocationLimit,
      spatialIndexes,
      suggestedProfile:
        resolvedProfile === "full" &&
        args.projection.profilePeaks.view.largestPlannedAllocationBytes <= allocationLimit
          ? "view"
          : undefined,
    });
  }
  return {
    requestedProfile: args.requestedProfile,
    resolvedProfile,
    spatialIndexes,
    projection: args.projection,
    selectedPeak,
    capabilities: args.capabilities,
    limits: {
      allNodeSpatialIndexBytes: ALL_NODE_SPATIAL_INDEX_LIMIT,
      projectedTypedArrayPeakBytes: typedPeakLimit,
      largestPlannedAllocationBytes: allocationLimit,
    },
    diagnostics,
  };
}

/** Resolve Auto conservatively; an explicit Full or View request always wins. */
export function selectOsmLoadProfile(
  requestedProfile: OsmLoadProfile,
  projection: OsmLoadProjection,
  capabilities: OsmLoadCapabilities = {},
): OsmLoadDecision {
  const limits = computeOsmLoadLimits(capabilities);
  const { typedPeakLimit, allocationLimit } = limits;
  const checks: Array<{ diagnostic: OsmLoadDiagnostic; passes: boolean }> = [
    {
      passes: projection.allNodeSpatialIndexBytes <= ALL_NODE_SPATIAL_INDEX_LIMIT,
      diagnostic: {
        code: "all-node-index-limit",
        level: "warning",
        message: `All-node index requires ${formatMib(projection.allNodeSpatialIndexBytes)}; Auto Full allows at most ${formatMib(ALL_NODE_SPATIAL_INDEX_LIMIT)}.`,
      },
    },
    {
      passes: projection.projectedTypedArrayPeakBytes <= typedPeakLimit,
      diagnostic: {
        code: "typed-array-peak-limit",
        level: "warning",
        message: `Projected typed-array peak is ${formatMib(projection.projectedTypedArrayPeakBytes)}; this system's Auto limit is ${formatMib(typedPeakLimit)}.`,
      },
    },
  ];
  if (allocationLimit !== undefined) {
    checks.push({
      passes: projection.largestPlannedAllocationBytes <= allocationLimit,
      diagnostic: {
        code: "single-allocation-limit",
        level: "warning",
        message: `Largest planned allocation is ${formatMib(projection.largestPlannedAllocationBytes)}; the active-buffer headroom limit is ${formatMib(allocationLimit)}.`,
      },
    });
  }

  const autoFull = checks.every((check) => check.passes);
  const resolvedProfile =
    requestedProfile === "auto" ? (autoFull ? "full" : "view") : requestedProfile;
  const diagnostics =
    requestedProfile === "auto"
      ? checks.filter((check) => !check.passes).map((check) => check.diagnostic)
      : [];
  if (requestedProfile !== "auto") {
    diagnostics.unshift({
      code: "explicit-profile",
      level: "info",
      message: `${requestedProfile === "full" ? "Full" : "View"} was selected explicitly; automatic limits were not applied.`,
    });
  } else if (autoFull) {
    diagnostics.push({
      code: "within-auto-limits",
      level: "info",
      message: "The Full profile fits all automatic memory limits.",
    });
  }

  const spatialIndexes = normalizeOsmSpatialIndexSelection(
    resolvedProfile === "full" ? FULL_SPATIAL_INDEX_SELECTION : VIEW_SPATIAL_INDEX_SELECTION,
  );
  return finalizeOsmLoadDecision({
    requestedProfile,
    resolvedProfile,
    spatialIndexes,
    peakWarningSubject: `The selected ${resolvedProfile === "full" ? "Full" : "View"} profile`,
    selectedPeak: projection.profilePeaks[resolvedProfile],
    projection,
    capabilities,
    limits,
    diagnostics,
  });
}

/** Create a decision for an exact caller-supplied spatial-index selection. */
export function selectOsmSpatialIndexes(
  selection: OsmSpatialIndexSelection,
  projection: OsmLoadProjection,
  capabilities: OsmLoadCapabilities = {},
): OsmLoadDecision {
  const spatialIndexes = normalizeOsmSpatialIndexSelection(selection);
  const resolvedProfile: ResolvedOsmLoadProfile = spatialIndexes.nodes.includes("all")
    ? "full"
    : "view";
  return finalizeOsmLoadDecision({
    requestedProfile: resolvedProfile,
    resolvedProfile,
    spatialIndexes,
    peakWarningSubject: "The selected indexes",
    selectedPeak: projectSelectionPeak(projection, spatialIndexes),
    projection,
    capabilities,
    limits: computeOsmLoadLimits(capabilities),
    diagnostics: [
      {
        code: "explicit-spatial-index-selection",
        level: "info",
        message:
          "An explicit spatial-index selection was supplied; profile defaults were not applied.",
      },
    ],
  });
}

const loadDecisions = new WeakMap<Osm, OsmLoadDecision>();

export function setOsmLoadDecision(osm: Osm, decision: OsmLoadDecision): void {
  loadDecisions.set(osm, decision);
}

export function getOsmLoadDecision(osm: Osm): OsmLoadDecision | null {
  return loadDecisions.get(osm) ?? null;
}

/** Build the spatial indexes required by a resolved load profile. */
export function buildOsmSpatialIndexesForProfile(osm: Osm, profile: ResolvedOsmLoadProfile): void {
  buildSelectedOsmSpatialIndexes(
    osm,
    profile === "full" ? FULL_SPATIAL_INDEX_SELECTION : VIEW_SPATIAL_INDEX_SELECTION,
  );
}

/** Build an explicit spatial-index selection, deduplicating node index kinds. */
export function buildSelectedOsmSpatialIndexes(
  osm: Osm,
  selection: OsmSpatialIndexSelection,
  phaseTimingsMs?: Record<string, number>,
): void {
  const normalized = normalizeOsmSpatialIndexSelection(selection);
  for (const kind of normalized.nodes) {
    const startedAt = performance.now();
    try {
      osm.nodes.buildSpatialIndex(kind);
    } catch (error) {
      throw new OsmSpatialIndexBuildError("node", kind, error);
    } finally {
      recordPhaseTiming(phaseTimingsMs, `${kind}NodeSpatialIndex`, startedAt);
    }
  }
  if (normalized.ways) {
    const startedAt = performance.now();
    try {
      osm.ways.buildSpatialIndex();
    } catch (error) {
      throw new OsmSpatialIndexBuildError("way", undefined, error);
    } finally {
      recordPhaseTiming(phaseTimingsMs, "waySpatialIndex", startedAt);
    }
  }
  if (normalized.relations) {
    const startedAt = performance.now();
    try {
      osm.relations.buildSpatialIndex();
    } catch (error) {
      throw new OsmSpatialIndexBuildError("relation", undefined, error);
    } finally {
      recordPhaseTiming(phaseTimingsMs, "relationSpatialIndex", startedAt);
    }
  }
}

function recordPhaseTiming(
  phaseTimingsMs: Record<string, number> | undefined,
  key: string,
  startedAt: number,
): void {
  if (!phaseTimingsMs) return;
  phaseTimingsMs[key] = (phaseTimingsMs[key] ?? 0) + performance.now() - startedAt;
}
