import { createReadStream } from "node:fs";
import { Readable } from "node:stream";

import { GenerationGate, type GenerationGateTransferables } from "@osmix/shared/generation-gate";
import {
  ShortbreadFeatureIndex,
  type ShortbreadFeatureIndexTransferables,
} from "@osmix/shortbread";
import {
  OsmixWorker,
  progressEvent,
  transfer,
  type OsmFromPbfOptions,
  type OsmTransferables,
  type Tile,
} from "osmix";

import { MapCamera, type MapViewport } from "./camera.ts";
import { collectMapLabelCandidates, type MapLabelCandidate } from "./map-labels.ts";
import { SemanticLabelIndex } from "./semantic-label-index.ts";
import { SemanticNodeIndex, type SemanticNodeIndexTransferables } from "./semantic-node-index.ts";
import {
  SemanticRenderIndex,
  type SemanticRenderIndexTransferables,
} from "./semantic-render-index.ts";
import { drawStyledMapTile, drawStyledMapTileAsync } from "./styled-tile.ts";

export interface MapLabelQueryRequest {
  centerX: number;
  centerY: number;
  revision: number;
  viewport: MapViewport;
  zoom: number;
}

export interface MapLabelQueryResult {
  candidates: MapLabelCandidate[];
  revision: number;
}

interface CachedSemanticNodeIndex {
  contentHash: string;
  index: SemanticNodeIndex;
}

interface CachedSemanticLabelIndex {
  contentHash: string;
  index: SemanticLabelIndex;
}

interface CachedSemanticRenderIndex {
  contentHash: string;
  index: SemanticRenderIndex;
}

interface CachedShortbreadFeatureIndex {
  contentHash: string;
  index: ShortbreadFeatureIndex;
}

/** Osmix worker extension for the TUI's private semantic raster style. */
export class TuiTileWorker extends OsmixWorker {
  private readonly tileGenerationGate = GenerationGate.create({ shared: false });
  private readonly semanticLabelIndexes = new Map<string, CachedSemanticLabelIndex>();
  private readonly semanticNodeIndexes = new Map<string, CachedSemanticNodeIndex>();
  private readonly semanticRenderIndexes = new Map<string, CachedSemanticRenderIndex>();
  private readonly shortbreadFeatureIndexes = new Map<string, CachedShortbreadFeatureIndex>();

  async fromPbfFile(filePath: string, options: Partial<OsmFromPbfOptions> = {}) {
    const stream = createReadStream(filePath);
    try {
      const info = await this.fromPbf({
        data: Readable.toWeb(stream) as ReadableStream<Uint8Array>,
        options,
      });
      this.semanticLabelIndexes.delete(info.id);
      this.semanticNodeIndexes.delete(info.id);
      this.semanticRenderIndexes.delete(info.id);
      this.shortbreadFeatureIndexes.delete(info.id);
      this.buildShortbreadFeatureIndex(info.id, true);
      this.buildSemanticNodeIndex(info.id, true);
      this.buildSemanticLabelIndex(info.id, true);
      this.buildSemanticRenderIndex(info.id, true);
      return info;
    } finally {
      stream.destroy();
    }
  }

  override transferIn(transferables: OsmTransferables): void {
    const cachedFeatures = this.shortbreadFeatureIndexes.get(transferables.id);
    if (cachedFeatures?.contentHash !== transferables.contentHash) {
      this.shortbreadFeatureIndexes.delete(transferables.id);
    }
    const cachedLabels = this.semanticLabelIndexes.get(transferables.id);
    if (cachedLabels?.contentHash !== transferables.contentHash) {
      this.semanticLabelIndexes.delete(transferables.id);
    }
    const cached = this.semanticNodeIndexes.get(transferables.id);
    if (cached?.contentHash !== transferables.contentHash) {
      this.semanticNodeIndexes.delete(transferables.id);
    }
    const cachedRender = this.semanticRenderIndexes.get(transferables.id);
    if (cachedRender?.contentHash !== transferables.contentHash) {
      this.semanticRenderIndexes.delete(transferables.id);
    }
    super.transferIn(transferables);
  }

  override delete(id: string): void {
    this.semanticLabelIndexes.delete(id);
    this.semanticNodeIndexes.delete(id);
    this.semanticRenderIndexes.delete(id);
    this.shortbreadFeatureIndexes.delete(id);
    super.delete(id);
  }

  buildShortbreadFeatureIndex(id: string, reportProgress = false): { features: number } {
    if (reportProgress) this.dispatchEvent(progressEvent("Indexing Shortbread map features..."));
    const osm = this.get(id);
    const index = ShortbreadFeatureIndex.build(osm);
    this.shortbreadFeatureIndexes.set(id, { contentHash: osm.contentHash(), index });
    if (reportProgress) {
      this.dispatchEvent(
        progressEvent(`Indexed ${index.size.toLocaleString()} classified map features.`),
      );
    }
    return { features: index.size };
  }

  buildSemanticNodeIndex(id: string, reportProgress = false): { labels: number; nodes: number } {
    if (reportProgress) this.dispatchEvent(progressEvent("Indexing semantic map points..."));
    const osm = this.get(id);
    const index = SemanticNodeIndex.build(osm, this.getShortbreadFeatureIndex(id));
    this.semanticNodeIndexes.set(id, { contentHash: osm.contentHash(), index });
    if (reportProgress) {
      this.dispatchEvent(
        progressEvent(
          `Indexed ${index.size.toLocaleString()} semantic map points for terminal rendering.`,
        ),
      );
    }
    return { labels: index.labelCount, nodes: index.size };
  }

  buildSemanticLabelIndex(id: string, reportProgress = false): { relations: number; ways: number } {
    if (reportProgress) this.dispatchEvent(progressEvent("Indexing semantic map labels..."));
    const osm = this.get(id);
    const index = SemanticLabelIndex.build(osm, this.getShortbreadFeatureIndex(id));
    this.semanticLabelIndexes.set(id, { contentHash: osm.contentHash(), index });
    if (reportProgress) {
      this.dispatchEvent(
        progressEvent(
          `Indexed ${(index.wayCount + index.relationCount).toLocaleString()} semantic map labels.`,
        ),
      );
    }
    return { relations: index.relationCount, ways: index.wayCount };
  }

  buildSemanticRenderIndex(
    id: string,
    reportProgress = false,
  ): { relations: number; ways: number } {
    if (reportProgress) this.dispatchEvent(progressEvent("Indexing semantic map geometry..."));
    const osm = this.get(id);
    const index = SemanticRenderIndex.build(osm, this.getShortbreadFeatureIndex(id));
    this.semanticRenderIndexes.set(id, { contentHash: osm.contentHash(), index });
    if (reportProgress) {
      this.dispatchEvent(
        progressEvent(
          `Indexed ${(index.wayCount + index.relationCount).toLocaleString()} semantic map features.`,
        ),
      );
    }
    return { relations: index.relationCount, ways: index.wayCount };
  }

  getSemanticNodeIndexTransferables(id: string): SemanticNodeIndexTransferables {
    return this.getSemanticNodeIndex(id).transferables();
  }

  getShortbreadFeatureIndexTransferables(id: string): ShortbreadFeatureIndexTransferables {
    return this.getShortbreadFeatureIndex(id).transferables();
  }

  setShortbreadFeatureIndex(
    id: string,
    contentHash: string,
    transferables: ShortbreadFeatureIndexTransferables,
  ): void {
    if (this.get(id).contentHash() !== contentHash) {
      throw Error(`Shortbread feature index content mismatch for id: ${id}`);
    }
    this.shortbreadFeatureIndexes.set(id, {
      contentHash,
      index: ShortbreadFeatureIndex.fromTransferables(transferables),
    });
  }

  setSemanticNodeIndex(
    id: string,
    contentHash: string,
    transferables: SemanticNodeIndexTransferables,
  ): void {
    if (this.get(id).contentHash() !== contentHash) {
      throw Error(`Semantic node index content mismatch for id: ${id}`);
    }
    this.installShortbreadFeatureIndex(id, contentHash, transferables.featureIndex);
    this.semanticNodeIndexes.set(id, {
      contentHash,
      index: SemanticNodeIndex.fromTransferables(transferables, this.getShortbreadFeatureIndex(id)),
    });
  }

  getSemanticRenderIndexTransferables(id: string): SemanticRenderIndexTransferables {
    return this.getSemanticRenderIndex(id).transferables();
  }

  setSemanticRenderIndex(
    id: string,
    contentHash: string,
    transferables: SemanticRenderIndexTransferables,
  ): void {
    if (this.get(id).contentHash() !== contentHash) {
      throw Error(`Semantic render index content mismatch for id: ${id}`);
    }
    this.installShortbreadFeatureIndex(id, contentHash, transferables.featureIndex);
    this.semanticRenderIndexes.set(id, {
      contentHash,
      index: SemanticRenderIndex.fromTransferables(
        transferables,
        this.getShortbreadFeatureIndex(id),
      ),
    });
  }

  getMapLabelCandidates(id: string, request: MapLabelQueryRequest): MapLabelQueryResult {
    const camera = new MapCamera(request.centerX, request.centerY, request.zoom);
    const index = this.getSemanticNodeIndex(id);
    const nodes = index.findLabelNodes(camera.visibleBboxes(request.viewport), camera.zoom);
    const providers = this.getSemanticLabelIndex(id).providers(camera.zoom);
    return {
      candidates: collectMapLabelCandidates(this.get(id), camera, request.viewport, {
        nodes,
        ...providers,
      }),
      revision: request.revision,
    };
  }

  /** Receive cooperative cancellation updates while an asynchronous tile job is yielded. */
  cancelTilesBefore(generation: number): void {
    this.tileGenerationGate.update(generation);
  }

  getStyledRasterTile(
    id: string,
    tile: Tile,
    generation = 0,
    cancellationState?: GenerationGateTransferables,
  ): Uint8ClampedArray | null {
    const osm = this.get(id);
    const renderIndex = this.getSemanticRenderIndex(id);
    const nodeIndex = tile[2] >= 14 ? this.getSemanticNodeIndex(id) : undefined;
    const cancellation = cancellationState
      ? GenerationGate.fromTransferables(cancellationState)
      : null;
    const isCancelled = () => cancellation?.isCancelled(generation) ?? false;
    if (isCancelled()) return null;
    const imageData = drawStyledMapTile(
      osm,
      tile,
      256,
      nodeIndex,
      {
        relations: renderIndex.relations(osm.relations, tile[2]),
        ways: renderIndex.ways(osm.ways, tile[2]),
      },
      isCancelled,
    ).imageData;
    return isCancelled() ? null : transfer(imageData);
  }

  /** Render without SharedArrayBuffer while yielding often enough to service cancel RPCs. */
  async getStyledRasterTileCooperatively(
    id: string,
    tile: Tile,
    generation = 0,
  ): Promise<Uint8ClampedArray | null> {
    const isCancelled = () => this.tileGenerationGate.isCancelled(generation);
    if (isCancelled()) return null;
    const osm = this.get(id);
    const renderIndex = this.getSemanticRenderIndex(id);
    const nodeIndex = tile[2] >= 14 ? this.getSemanticNodeIndex(id) : undefined;
    const imageData = (
      await drawStyledMapTileAsync(
        osm,
        tile,
        256,
        nodeIndex,
        {
          relations: renderIndex.relations(osm.relations, tile[2]),
          ways: renderIndex.ways(osm.ways, tile[2]),
        },
        isCancelled,
      )
    ).imageData;
    return isCancelled() ? null : transfer(imageData);
  }

  private getSemanticNodeIndex(id: string): SemanticNodeIndex {
    let cached = this.semanticNodeIndexes.get(id);
    if (!cached || cached.contentHash !== this.get(id).contentHash()) {
      this.buildSemanticNodeIndex(id);
      cached = this.semanticNodeIndexes.get(id);
    }
    if (!cached) throw Error(`Semantic node index not found for id: ${id}`);
    return cached.index;
  }

  private getSemanticLabelIndex(id: string): SemanticLabelIndex {
    let cached = this.semanticLabelIndexes.get(id);
    if (!cached || cached.contentHash !== this.get(id).contentHash()) {
      this.buildSemanticLabelIndex(id);
      cached = this.semanticLabelIndexes.get(id);
    }
    if (!cached) throw Error(`Semantic label index not found for id: ${id}`);
    return cached.index;
  }

  private getSemanticRenderIndex(id: string): SemanticRenderIndex {
    let cached = this.semanticRenderIndexes.get(id);
    if (!cached || cached.contentHash !== this.get(id).contentHash()) {
      this.buildSemanticRenderIndex(id);
      cached = this.semanticRenderIndexes.get(id);
    }
    if (!cached) throw Error(`Semantic render index not found for id: ${id}`);
    return cached.index;
  }

  private getShortbreadFeatureIndex(id: string): ShortbreadFeatureIndex {
    let cached = this.shortbreadFeatureIndexes.get(id);
    if (!cached || cached.contentHash !== this.get(id).contentHash()) {
      this.buildShortbreadFeatureIndex(id);
      cached = this.shortbreadFeatureIndexes.get(id);
    }
    if (!cached) throw Error(`Shortbread feature index not found for id: ${id}`);
    return cached.index;
  }

  private installShortbreadFeatureIndex(
    id: string,
    contentHash: string,
    transferables: ShortbreadFeatureIndexTransferables,
  ): void {
    const cached = this.shortbreadFeatureIndexes.get(id);
    if (cached?.contentHash === contentHash) return;
    this.shortbreadFeatureIndexes.set(id, {
      contentHash,
      index: ShortbreadFeatureIndex.fromTransferables(transferables),
    });
  }
}
