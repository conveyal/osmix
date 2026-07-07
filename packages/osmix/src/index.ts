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
  OsmixRemote,
  type OsmFileType,
  type OsmId,
  type OsmRemoteDataset,
  type OsmixRemoteOptions,
} from "./remote.ts";
export { OsmixWorker, type RouteResult, type WaySegment } from "./worker.ts";
export { drawToRasterTile, type DrawToRasterTileOptions } from "./raster.ts";
export {
  DEFAULT_WORKER_COUNT,
  SUPPORTS_SHARED_ARRAY_BUFFER,
  SUPPORTS_STREAM_TRANSFER,
} from "./settings.ts";
export {
  collectTransferables,
  supportsReadableStreamTransfer,
  transfer,
  type Transferables,
} from "./utils.ts";

// --- @osmix/change ---
export {
  applyChangesetToOsm,
  generateChangeset,
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
  waysIntersect,
  waysShouldConnect,
} from "@osmix/change";
export type {
  OscOptions,
  OsmChange,
  OsmChanges,
  OsmChangesetStats,
  OsmChangeTypes,
  OsmEntityRef,
  OsmMergeOptions,
} from "@osmix/change";

// --- @osmix/core ---
export { BufferConstructor, Nodes, Osm, Relations, Tags, Ways } from "@osmix/core";
export type {
  IdOrIndex,
  OsmInfo,
  OsmOptions,
  OsmReader,
  OsmTransferables,
  OsmWriter,
  BufferType,
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
  entityMatchesTagRules,
  fromPbf,
  hasExtractTagFilter,
  nodeMatchesExtractTagRules,
  normalizeTagFilterRules,
  readOsmPbfHeader,
  relationMatchesExtractTagRules,
  startCreateOsmFromPbf,
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
  OsmFromPbfOptions,
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
