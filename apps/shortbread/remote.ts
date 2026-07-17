import { inspectBackingBuffers } from "@osmix/shared/backing-buffers";
import type { ShortbreadFeatureIndexTransferables } from "@osmix/shortbread";
import type { Remote } from "comlink";
import type { Progress } from "osmix";
import { canShareArrayBuffers, type OsmId, OsmixRemote } from "osmix";

import type { ShortbreadWorker } from "./shortbread.worker.ts";

export interface CreateShortbreadRemoteOptions {
  onProgress?: (progress: Progress) => void;
  workerCount: number;
  workerUrl: URL;
}

/** Create a Shortbread remote whose feature indexes are shared and recoverable. */
export async function createShortbreadRemote({
  onProgress,
  workerCount,
  workerUrl,
}: CreateShortbreadRemoteOptions): Promise<ShortbreadRemote> {
  const remote = new ShortbreadRemote();
  await remote.initializeWorkerPool(workerCount, workerUrl, onProgress);
  return remote;
}

/** Osmix remote that prepares one shared Shortbread index for each dataset. */
export class ShortbreadRemote extends OsmixRemote<ShortbreadWorker> {
  private readonly featureIndexes = new Map<string, ShortbreadFeatureIndexTransferables>();
  private readonly featureIndexIds = new Set<string>();

  override async fromPbf(...args: Parameters<OsmixRemote<ShortbreadWorker>["fromPbf"]>) {
    const dataset = await super.fromPbf(...args);
    await this.prepareFeatureIndex(dataset.id);
    return dataset;
  }

  override async delete(osmId: OsmId): Promise<void> {
    const id = this.getId(osmId);
    this.featureIndexes.delete(id);
    this.featureIndexIds.delete(id);
    await super.delete(osmId);
  }

  /** Inspect each worker's shared feature-index installation for stress diagnostics. */
  getFeatureIndexDiagnostics(osmId: OsmId) {
    const id = this.getId(osmId);
    return this.broadcastToWorkers((worker) => worker.getShortbreadFeatureIndexInfo(id), {
      retry: "once",
    });
  }

  protected override async rehydrateWorker(worker: Remote<ShortbreadWorker>): Promise<void> {
    for (const id of this.featureIndexIds) {
      const transferables = this.featureIndexes.get(id);
      if (transferables) {
        await worker.setShortbreadFeatureIndex(id, transferables);
      } else {
        // A non-shared index is intentionally not retained on the main thread.
        await worker.buildShortbreadFeatureIndexInPlace(id);
      }
    }
  }

  private async prepareFeatureIndex(id: string): Promise<void> {
    this.featureIndexIds.add(id);
    if (!canShareArrayBuffers()) {
      await this.runWithWorker((worker) => worker.buildShortbreadFeatureIndexInPlace(id), {
        lane: "control",
        retry: "once",
      });
      this.featureIndexes.delete(id);
      return;
    }
    const transferables = await this.runWithWorker(
      (worker) => worker.buildShortbreadFeatureIndex(id),
      { lane: "control", retry: "once" },
    );
    const buffers = inspectBackingBuffers(transferables);
    if (buffers.unique > 0 && buffers.shared === buffers.unique) {
      this.featureIndexes.set(id, transferables);
    } else {
      this.featureIndexes.delete(id);
      // The control worker already owns this non-shared index. Sending it back
      // through Comlink would create a transient full clone for no benefit.
      return;
    }
    await this.broadcastToWorkers((worker) => worker.setShortbreadFeatureIndex(id, transferables), {
      retry: "once",
    });
  }
}
