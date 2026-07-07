/**
 * PBF loading and serialization utilities.
 *
 * Provides functions for loading OSM PBF data into Osm indexes and
 * serializing Osm indexes back to PBF format. Supports streaming
 * for memory-efficient processing of large datasets.
 *
 * @module
 */

import { Osm, type OsmOptions } from "@osmix/core";
import { OsmBlocksToJsonTransformStream, OsmJsonToBlocksTransformStream } from "@osmix/json";
import {
  type AsyncGeneratorValue,
  OsmBlocksToPbfBytesTransformStream,
  OsmPbfBytesToBlocksTransformStream,
  readOsmPbf,
} from "@osmix/pbf";
import { logProgress, type ProgressEvent, progressEvent } from "@osmix/shared/progress";
import type {
  GeoBbox2D,
  OsmEntityType,
  OsmEntityTypeMap,
  OsmNode,
  OsmRelation,
  OsmWay,
} from "@osmix/types";

import { createReadableEntityStreamFromOsm } from "./entity-stream.ts";
import {
  type ExtractTagFilterRules,
  hasExtractTagFilter,
  nodeMatchesExtractTagRules,
  normalizeTagFilterRules,
  relationMatchesExtractTagRules,
  wayMatchesExtractTagRules,
} from "./extract-tag-filter.ts";
import { createExtract, type ExtractStrategy } from "./extract.ts";

/** When `extractBbox` is set but `extractStrategy` is omitted, default to in-stream simple extract. */
function resolveEffectiveExtractStrategy(
  extractBbox: GeoBbox2D | undefined,
  extractStrategy: ExtractStrategy | undefined,
): ExtractStrategy | undefined {
  if (extractStrategy !== undefined) return extractStrategy;
  if (extractBbox !== undefined) return "simple";
  return undefined;
}

/**
 * Options for loading OSM data from PBF.
 */
export interface OsmFromPbfOptions extends OsmOptions {
  extractBbox: GeoBbox2D;
  extractStrategy: ExtractStrategy;
  /** Optional tag-filter rules (worker-safe). Omitted => no tag filtering. */
  extractTagFilter?: ExtractTagFilterRules;
  filter<T extends OsmEntityType>(type: T, entity: OsmEntityTypeMap[T], osmix: Osm): boolean;
  buildSpatialIndexes: OsmEntityType[];
}

function composeNodeIngestFilter(
  bboxFilter: ((node: OsmNode) => boolean) | undefined,
  tagRules: ExtractTagFilterRules | null,
  entityFilter: OsmFromPbfOptions["filter"] | undefined,
  osm: Osm,
): ((node: OsmNode) => boolean) | undefined {
  const applyNodeTags = tagRules !== null && tagRules.nodes.length > 0;
  if (!bboxFilter && !applyNodeTags && !entityFilter) return undefined;
  return (node: OsmNode) => {
    if (bboxFilter && !bboxFilter(node)) return false;
    // Dense node tag filtering may leave orphan refs when nodes precede ways in a block.
    if (applyNodeTags && !nodeMatchesExtractTagRules(node, tagRules!)) return false;
    if (entityFilter && !entityFilter("node", node, osm)) return false;
    return true;
  };
}

function composeWayIngestFilter(
  spatialFilter: ((way: OsmWay) => OsmWay | null) | undefined,
  tagRules: ExtractTagFilterRules | null,
  entityFilter: OsmFromPbfOptions["filter"] | undefined,
  osm: Osm,
): ((way: OsmWay) => OsmWay | null) | undefined {
  const applyWayTags = tagRules !== null && tagRules.ways.length > 0;
  if (!spatialFilter && !applyWayTags && !entityFilter) return undefined;
  return (way: OsmWay) => {
    let w: OsmWay | null = way;
    if (spatialFilter) {
      w = spatialFilter(way);
      if (w === null) return null;
    }
    if (applyWayTags && !wayMatchesExtractTagRules(w, tagRules!)) return null;
    if (entityFilter && !entityFilter("way", w, osm)) return null;
    return w;
  };
}

function composeRelationIngestFilter(
  spatialFilter: ((relation: OsmRelation) => OsmRelation | null) | undefined,
  tagRules: ExtractTagFilterRules | null,
  entityFilter: OsmFromPbfOptions["filter"] | undefined,
  osm: Osm,
): ((relation: OsmRelation) => OsmRelation | null) | undefined {
  const applyRelationTags = tagRules !== null && tagRules.relations.length > 0;
  if (!spatialFilter && !applyRelationTags && !entityFilter) return undefined;
  return (relation: OsmRelation) => {
    let r: OsmRelation | null = relation;
    if (spatialFilter) {
      r = spatialFilter(relation);
      if (r === null) return null;
    }
    if (applyRelationTags && !relationMatchesExtractTagRules(r, tagRules!)) return null;
    if (entityFilter && !entityFilter("relation", r, osm)) return null;
    return r;
  };
}

/**
 * Read only the header block from PBF data without parsing entities.
 * Useful for previewing metadata before loading the entire dataset.
 */
export async function readOsmPbfHeader(data: Parameters<typeof readOsmPbf>[0]) {
  const { header } = await readOsmPbf(data);
  return header;
}

/**
 * Create a new Osm index from PBF data (stream or buffer).
 * Parses all OSM entities, builds ID and tag indexes, and constructs spatial indexes.
 * Supports optional bbox extraction and entity filtering during ingestion.
 */
export async function fromPbf(
  data: AsyncGeneratorValue<Uint8Array<ArrayBufferLike>>,
  options: Partial<OsmFromPbfOptions> = {},
  onProgress: (progress: ProgressEvent) => void = logProgress,
): Promise<Osm> {
  const createOsm = startCreateOsmFromPbf(data, options);
  do {
    const { value, done } = await createOsm.next();
    if (done) return value;
    onProgress(value);
  } while (true);
}

/**
 * Parse raw PBF data into an Osm index.
 * Yields progress events during parsing and index building.
 * Returns the completed Osm instance when done.
 */
export async function* startCreateOsmFromPbf(
  data: AsyncGeneratorValue<Uint8Array<ArrayBufferLike>>,
  options: Partial<OsmFromPbfOptions> = {},
): AsyncGenerator<ProgressEvent, Osm> {
  const { extractBbox, extractStrategy } = options;
  const effectiveExtractStrategy = resolveEffectiveExtractStrategy(extractBbox, extractStrategy);
  const tagRules = options.extractTagFilter
    ? normalizeTagFilterRules(options.extractTagFilter)
    : null;
  const tagRulesActive = tagRules !== null && hasExtractTagFilter(tagRules) ? tagRules : null;
  const entityFilter = options.filter;
  const { header, blocks } = await readOsmPbf(data);
  const osm = new Osm({
    ...options,
    header,
  });
  if (extractBbox) {
    osm.header.bbox = {
      left: extractBbox[0],
      bottom: extractBbox[1],
      right: extractBbox[2],
      top: extractBbox[3],
    };
  }

  const simpleSpatialNodeFilter =
    extractBbox && effectiveExtractStrategy === "simple"
      ? (node: OsmNode) => {
          return (
            node.lon >= extractBbox[0] &&
            node.lon <= extractBbox[2] &&
            node.lat >= extractBbox[1] &&
            node.lat <= extractBbox[3]
          );
        }
      : undefined;

  const nodeIngestFilter = composeNodeIngestFilter(
    simpleSpatialNodeFilter,
    tagRulesActive,
    entityFilter,
    osm,
  );

  let blockCount = 0;
  for await (const block of blocks) {
    const blockStringIndexMap = osm.stringTable.createBlockIndexMap(block.stringtable);

    for (const group of block.primitivegroup) {
      const { nodes, ways, relations, dense } = group;
      if (nodes && nodes.length > 0) throw Error("Nodes must be dense!");

      if (dense) {
        osm.nodes.addDenseNodes(dense, block, blockStringIndexMap, nodeIngestFilter);
      }

      if (ways.length > 0) {
        // Nodes are finished, build their index.
        if (!osm.nodes.isReady()) osm.nodes.buildIndex();
        const simpleWaySpatial =
          extractBbox && effectiveExtractStrategy === "simple"
            ? (way: OsmWay) => {
                const refs = way.refs.filter((ref) => osm.nodes.ids.has(ref));
                if (refs.length === 0) return null;
                return {
                  ...way,
                  refs,
                };
              }
            : undefined;
        osm.ways.addWays(
          ways,
          blockStringIndexMap,
          composeWayIngestFilter(simpleWaySpatial, tagRulesActive, entityFilter, osm),
        );
      }

      if (relations.length > 0) {
        if (!osm.ways.isReady()) osm.ways.buildIndex();
        const simpleRelationSpatial =
          extractBbox && effectiveExtractStrategy === "simple"
            ? (relation: OsmRelation) => {
                const members = relation.members.filter((member) => {
                  if (member.type === "node") return osm.nodes.ids.has(member.ref);
                  if (member.type === "way") return osm.ways.ids.has(member.ref);
                  return false;
                });
                if (members.length === 0) return null;
                return {
                  ...relation,
                  members,
                };
              }
            : undefined;
        osm.relations.addRelations(
          relations,
          blockStringIndexMap,
          composeRelationIngestFilter(simpleRelationSpatial, tagRulesActive, entityFilter, osm),
        );
      }
    }

    blockCount++;
    yield progressEvent(
      `Processed ${blockCount.toLocaleString()} blocks, ${osm.nodes.size.toLocaleString()} nodes, ${osm.ways.size.toLocaleString()} ways, and ${osm.relations.size.toLocaleString()} relations added.`,
    );
  }

  yield progressEvent(
    `${osm.nodes.size.toLocaleString()} nodes, ${osm.ways.size.toLocaleString()} ways, and ${osm.relations.size.toLocaleString()} relations added.`,
  );
  yield progressEvent("Building ID and tag indexes...");
  osm.buildIndexes();

  // By default, build all spatial indexes.
  if (!Array.isArray(options.buildSpatialIndexes)) {
    yield progressEvent("Building all spatial indexes...");
    osm.buildSpatialIndexes();
  } else if (options.buildSpatialIndexes.includes("node")) {
    yield progressEvent("Building node spatial index...");
    osm.nodes.buildSpatialIndex();
  } else if (options.buildSpatialIndexes.includes("way")) {
    yield progressEvent("Building way spatial index...");
    osm.ways.buildSpatialIndex();
  } else if (options.buildSpatialIndexes.includes("relation")) {
    yield progressEvent("Building relation spatial index...");
    osm.relations.buildSpatialIndex();
  }

  if (
    extractBbox &&
    effectiveExtractStrategy !== undefined &&
    effectiveExtractStrategy !== "simple"
  ) {
    yield progressEvent(`Creating extract using strategy ${effectiveExtractStrategy}...`);
    const extractedOsm = createExtract(osm, extractBbox, effectiveExtractStrategy);
    yield progressEvent(`Finished creating extract. Loaded ${osm.id} PBF data into Osmix.`);
    return extractedOsm;
  }

  yield progressEvent(`Finished loading ${osm.id} PBF data into Osmix.`);
  return osm;
}

/**
 * Convert the OSM index to a ReadableStream of PBF-encoded bytes.
 * Entities are streamed, transformed into PBF blocks, and encoded on the fly.
 * Suitable for piping to file or network streams.
 */
export function toPbfStream(osm: Osm): ReadableStream<Uint8Array> {
  return createReadableEntityStreamFromOsm(osm)
    .pipeThrough(new OsmJsonToBlocksTransformStream())
    .pipeThrough(new OsmBlocksToPbfBytesTransformStream());
}

/**
 * Convert the OSM index to a single in-memory PBF buffer.
 * Collects all streamed chunks into a contiguous Uint8Array.
 * For large datasets, prefer osmToPbfStream to avoid memory pressure.
 */
export async function toPbfBuffer(osm: Osm): Promise<Uint8Array> {
  const chunks: Uint8Array[] = [];
  let byteLength = 0;
  const writable = new WritableStream<Uint8Array>({
    write(chunk) {
      chunks.push(chunk);
      byteLength += chunk.byteLength;
    },
  });
  await toPbfStream(osm).pipeTo(writable);
  const combined = new Uint8Array(byteLength);
  let offset = 0;
  for (const chunk of chunks) {
    combined.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return combined;
}

/**
 * Transform OSM PBF data into a stream of JSON entities.
 */
export function transformOsmPbfToJson(data: ArrayBufferLike | ReadableStream) {
  const dataStream =
    data instanceof ReadableStream
      ? data
      : new ReadableStream({
          start: (controller) => {
            controller.enqueue(new Uint8Array(data));
            controller.close();
          },
        });
  return dataStream
    .pipeThrough(new OsmPbfBytesToBlocksTransformStream())
    .pipeThrough(new OsmBlocksToJsonTransformStream());
}
