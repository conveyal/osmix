/**
 * Extended OsmixWorker with Shortbread vector tile support.
 *
 * This demonstrates how to extend OsmixWorker with custom functionality
 * by subclassing and adding new methods.
 */

import { inspectBackingBuffers } from "@osmix/shared/backing-buffers";
import {
  ShortbreadFeatureIndex,
  type ShortbreadFeatureIndexTransferables,
  ShortbreadVtEncoder,
} from "@osmix/shortbread";
import type { Tile } from "@osmix/types";
import * as Comlink from "comlink";
import { exposeOsmixWorker, OsmixWorker } from "osmix";

/**
 * Extended worker class that adds Shortbread vector tile generation.
 */
export class ShortbreadWorker extends OsmixWorker {
  private encoders: Map<string, ShortbreadVtEncoder> = new Map();
  private featureIndexes = new Map<string, ShortbreadFeatureIndex>();

  /**
   * Get or create a ShortbreadVtEncoder for the given Osm instance ID.
   */
  private getEncoder(id: string): ShortbreadVtEncoder {
    let encoder = this.encoders.get(id);
    if (!encoder) {
      const osmix = this.get(id);
      encoder = new ShortbreadVtEncoder(osmix, {
        featureIndex: this.featureIndexes.get(id),
      });
      this.encoders.set(id, encoder);
    }
    return encoder;
  }

  /** Build the shared Shortbread feature index on the control worker. */
  buildShortbreadFeatureIndex(id: string): ShortbreadFeatureIndexTransferables {
    const index = ShortbreadFeatureIndex.build(this.get(id));
    this.featureIndexes.set(id, index);
    this.encoders.delete(id);
    return index.transferables();
  }

  /** Build and retain an index without cloning its buffers back to the caller. */
  buildShortbreadFeatureIndexInPlace(id: string): number {
    const index = ShortbreadFeatureIndex.build(this.get(id));
    this.featureIndexes.set(id, index);
    this.encoders.delete(id);
    return index.size;
  }

  /** Install a previously-built shared feature index in this worker. */
  setShortbreadFeatureIndex(id: string, transferables: ShortbreadFeatureIndexTransferables): void {
    this.featureIndexes.set(id, ShortbreadFeatureIndex.fromTransferables(transferables));
    this.encoders.delete(id);
  }

  /** Return lightweight diagnostics without cloning index contents. */
  getShortbreadFeatureIndexInfo(id: string): {
    datasetArrayBufferCount: number;
    datasetSharedBufferCount: number;
    bufferCount: number;
    sharedBufferCount: number;
    size: number;
  } | null {
    const index = this.featureIndexes.get(id);
    if (!index) return null;
    const buffers = index.backingBuffers();
    const dataset = inspectBackingBuffers(this.getOsmBuffers(id));
    return {
      datasetArrayBufferCount: dataset.arrayBuffers,
      datasetSharedBufferCount: dataset.shared,
      bufferCount: buffers.length,
      sharedBufferCount: buffers.filter(
        (buffer) => typeof SharedArrayBuffer !== "undefined" && buffer instanceof SharedArrayBuffer,
      ).length,
      size: index.size,
    };
  }

  /**
   * Generate a Shortbread-compliant vector tile for the given tile coordinates.
   * Returns the MVT-encoded tile data as a transferable ArrayBuffer.
   */
  getShortbreadTile(id: string, tile: Tile): ArrayBuffer {
    const encoder = this.getEncoder(id);
    const data = encoder.getTile(tile);
    if (!data || data.byteLength === 0) return new ArrayBuffer(0);
    return Comlink.transfer(data, [data]);
  }

  /**
   * Get metadata about the Shortbread layers.
   */
  getShortbreadLayerNames(): string[] {
    return ShortbreadVtEncoder.layerNames;
  }

  /**
   * Override delete to also clean up cached encoders.
   */
  override delete(id: string) {
    this.encoders.delete(id);
    this.featureIndexes.delete(id);
    super.delete(id);
  }
}

// Expose the extended worker in either a Web Worker or Node worker thread.
void exposeOsmixWorker(new ShortbreadWorker());
