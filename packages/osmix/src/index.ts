/**
 * osmix - High-level entrypoint for the Osmix toolkit.
 *
 * @module osmix
 */

// --- Facade orchestration ---
export {
  createOsmixWorker,
  createRemote,
  detectFileType,
  OSM_FILE_TYPES,
  OsmixDatasetLossError,
  OsmixRemote,
  OsmixRemoteStateError,
  type OsmFileType,
  type OsmId,
  type OsmRemoteDataset,
  type OsmixRunWithWorkerOptions,
  type OsmixRemoteOptions,
  type OsmixWorkerLane,
} from "./remote.ts";
export {
  OsmixWorker,
  type OsmConflationCandidateView,
  type OsmConflationGenerationResult,
  type OsmConflationPage,
  type OsmConflationRoutingDelta,
  type OsmConflationRoutingDiagnostics,
  type OsmConflationRoutingGraphStats,
  type RouteResult,
  type WaySegment,
} from "./worker.ts";
export { drawToRasterTile, type DrawToRasterTileOptions } from "./raster.ts";
export {
  canShareArrayBuffers,
  getOsmixCapabilities,
  getWorkerRuntime,
  selectWorkerCount,
  type OsmixCapabilities,
  type OsmixMode,
  type SelectWorkerCountOptions,
  type WorkerRuntime,
} from "./capabilities.ts";
export {
  createOsmixWorkerConnection,
  createOsmixWorkerPool,
  defaultOsmixWorkerUrl,
  exposeOsmixWorker,
  OsmixWorkerPool,
  OsmixWorkerPoolDisposedError,
  OsmixWorkerTaskTimeoutError,
  OsmixWorkerUnavailableError,
  type CreateOsmixWorkerConnectionOptions,
  type OsmixWorkerConnection,
  type OsmixWorkerPingTarget,
  type OsmixWorkerPoolDiagnostics,
  type OsmixWorkerPoolOptions,
  type OsmixWorkerPoolRunOptions,
  type OsmixWorkerPoolTask,
  type OsmixWorkerPoolWorkerDiagnostics,
  type WorkerConnectionRuntime,
  type WorkerTaskRetry,
} from "./worker-pool.ts";
export {
  collectTransferables,
  supportsReadableStreamTransfer,
  transfer,
  type Transferables,
} from "./utils.ts";

// --- @osmix/change ---
export {
  applyChangesetToOsm,
  conflationEffectiveStatus,
  discoverConflationCandidates,
  filterConflationCandidates,
  generateChangeset,
  generateConflationApplicationChangeset,
  generateConflationChangeset,
  generateOscChanges,
  merge,
  OsmChangeset,
  camelCaseToSentenceCase,
  changeStatsSummary,
  cleanCoords,
  entityHasTagValue,
  getEntityVersion,
  isWayIntersectionCandidate,
  nearestNodeOnWay,
  osmTagsToOscTags,
  removeDuplicateAdjacentRelationMembers,
  removeDuplicateAdjacentWayRefs,
  summarizeConflationCandidates,
  validateConflationDecisions,
  waysIntersect,
  waysShouldConnect,
} from "@osmix/change";
export type {
  OscOptions,
  OsmChange,
  OsmChanges,
  OsmChangesetStats,
  OsmChangeTypes,
  OsmConflationActionAssessment,
  OsmConflationAutomatic,
  OsmConflationBulkAction,
  OsmConflationBulkDecisionPreview,
  OsmConflationBulkDecisionRequest,
  OsmConflationBulkDecisionResult,
  OsmConflationCandidate,
  OsmConflationCandidateFilter,
  OsmConflationDecision,
  OsmConflationDiscovery,
  OsmConflationEffectiveStatus,
  OsmConflationEntityType,
  OsmConflationEvidence,
  OsmConflationOptions,
  OsmConflationReasonCode,
  OsmConflationRoutingFamily,
  OsmConflationStatus,
  OsmConflationSummary,
  OsmConflationTagDiff,
  ResolvedOsmConflationOptions,
  OsmEntityRef,
  OsmMergeOptions,
} from "@osmix/change";

// --- @osmix/core ---
export {
  BufferConstructor,
  Nodes,
  Osm,
  OsmEntityIndexBuildError,
  Relations,
  SpatialIndexNotBuiltError,
  Tags,
  TypedBufferAllocationError,
  Ways,
} from "@osmix/core";
export type {
  BufferType,
  NodeSpatialIndexKind,
  IdOrIndex,
  OsmEntityIndexComponent,
  OsmInfo,
  OsmOptions,
  OsmReader,
  OsmTransferables,
  OsmWriter,
  TypedBufferAllocationOperation,
  TypedBufferType,
} from "@osmix/core";

// --- @osmix/geojson ---
export {
  fromGeoJSON,
  nodeToFeature,
  osmEntityToGeoJSONFeature,
  relationToFeature,
  startCreateOsmFromGeoJSON,
  wayToFeature,
} from "@osmix/geojson";
export type { OsmGeoJSONFeature } from "@osmix/geojson";

// --- @osmix/geoparquet ---
export { fromGeoParquet, GeoParquetOsmBuilder } from "@osmix/geoparquet";
export type { GeoParquetReadOptions, GeoParquetSource } from "@osmix/geoparquet";

// --- @osmix/gtfs ---
export {
  fromGtfs,
  GtfsArchive,
  GtfsOsmBuilder,
  isGtfsZip,
  routeTypeToOsmRoute,
  wheelchairBoardingToOsm,
} from "@osmix/gtfs";
export type { GtfsFileName, GtfsFileTypeMap } from "@osmix/gtfs";

// --- @osmix/json ---
export {
  OsmBlocksToJsonTransformStream,
  OsmJsonToBlocksTransformStream,
  OsmPbfBlockBuilder,
  OsmPbfBlockParser,
  blocksToJsonEntities,
  createOsmJsonReadableStream,
  osmJsonToPbf,
  osmPbfToJson,
  OSM_ENTITY_TYPES,
} from "@osmix/json";

// --- @osmix/load ---
export {
  CONVEYAL_EXTRACT_TAG_FILTERS,
  createExtract,
  buildOsmSpatialIndexesForProfile,
  buildSelectedOsmSpatialIndexes,
  entityMatchesTagRules,
  fromPbf,
  getOsmLoadDecision,
  getOsmStorableBufferBytes,
  getOsmTypedBufferBytes,
  hasExtractTagFilter,
  nodeMatchesExtractTagRules,
  normalizeTagFilterRules,
  OSM_LOAD_PROFILES,
  OsmLoadCapacityError,
  OsmSpatialIndexBuildError,
  projectOsmLoad,
  readOsmPbfHeader,
  relationMatchesExtractTagRules,
  startCreateOsmFromPbf,
  selectOsmLoadProfile,
  selectOsmSpatialIndexes,
  tagRuleMatches,
  toPbfBuffer,
  toPbfStream,
  transformOsmPbfToJson,
  wayMatchesExtractTagRules,
} from "@osmix/load";
export type {
  ExtractStrategy,
  ExtractTagFilterRule,
  ExtractTagFilterRules,
  OsmLoadCapabilities,
  OsmLoadDecision,
  OsmLoadDiagnostic,
  OsmLoadProfile,
  OsmLoadProjection,
  OsmLoadProfilePeak,
  OsmSpatialIndexSelection,
  OsmFromPbfOptions,
  ResolvedOsmLoadProfile,
} from "@osmix/load";

// --- @osmix/pbf ---
export {
  OsmBlocksToPbfBytesTransformStream,
  OsmPbfBytesToBlocksTransformStream,
  concatUint8,
  createOsmEntityCounter,
  readOsmPbf,
  toAsyncGenerator,
  uint32BE,
  webCompress,
  webDecompress,
} from "@osmix/pbf";
export type { OsmPbfBlock, OsmPbfGroup, OsmPbfHeaderBlock } from "@osmix/pbf";

// --- @osmix/raster ---
export { OsmixRasterTile, hexColorToRgba, normalizeHexColor } from "@osmix/raster";
export { compositeRGBA } from "@osmix/raster/color";

// --- @osmix/router ---
export { Router, RoutingGraph, buildGraph, defaultHighwayFilter } from "@osmix/router";
export type {
  DefaultSpeeds,
  HighwayFilter,
  RouteOptions,
  RoutingGraphTransferables,
} from "@osmix/router";

// --- @osmix/shapefile ---
export { fromShapefile, startCreateOsmFromShapefile } from "@osmix/shapefile";

// --- @osmix/types ---
export type {
  GeoBbox2D,
  ILonLat,
  LonLat,
  LonLatToPixel,
  LonLatToTilePixel,
  OsmEntity,
  OsmEntityType,
  OsmInfoParsed,
  OsmNode,
  OsmRelation,
  OsmRelationMember,
  OsmTags,
  OsmWay,
  RelationKind,
  RelationKindMetadata,
  Rgba,
  Tile,
  TilePxBbox,
  XY,
} from "@osmix/types";
export {
  bboxFromLonLats,
  entityPropertiesEqual,
  getEntityType,
  isMultipolygonRelation,
  isNode,
  isNodeEqual,
  isRelation,
  isRelationEqual,
  isWay,
  isWayEqual,
} from "@osmix/types/utils";
export {
  buildRelationLineStrings,
  collectRelationPoints,
  getRelationKind,
  getRelationKindMetadata,
  isAreaRelation,
  isLineRelation,
  isLogicRelation,
  isPointRelation,
  isSuperRelation,
  resolveRelationMembers,
} from "@osmix/types/relation-kind";
export { decodeZigzag, zigzag, zigzag32 } from "@osmix/types/zigzag";

// --- @osmix/vt ---
export { OsmixVtEncoder, projectToTile, writeVtPbf } from "@osmix/vt";

// --- @osmix/shared (plumbing re-exported for apps) ---
export {
  logProgress,
  progressEvent,
  progressEventMessage,
  type Progress,
  type ProgressEvent,
} from "@osmix/shared/progress";
