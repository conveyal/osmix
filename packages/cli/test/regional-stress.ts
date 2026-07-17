import { stat } from "node:fs/promises";

import { getOsmixCapabilities, type Tile } from "osmix";

import { MapCamera, TILE_SIZE, type MapViewport } from "../src/camera.ts";
import {
  OsmTileLoader,
  renderMapPixels,
  type PendingTileRegion,
  type TileImage,
} from "../src/map-pixels.ts";
import { createStyledTileRenderer } from "../src/tile-renderer.ts";

const HEARTBEAT_INTERVAL_MS = 25;
const ANIMATION_PHASE_MS = 100;
const MAX_MAIN_LOOP_STALL_MS = 250;
const MIN_ANIMATION_RATE_HZ = 8;
const DEFAULT_STAGE_TIMEOUT_MS = 10 * 60_000;
const RAPID_PAN_DELAY_MS = 15;
const CLOSE_ZOOM = 14;

interface LabelMetric {
  candidates: number;
  latencyMs: number;
  revisionMatched: boolean;
}

interface RevisionMetric {
  center: [number, number];
  initialPendingTiles: number;
  label?: LabelMetric;
  name: string;
  pendingRegions: number;
  requestedTiles: Set<string>;
  revision: number;
  submittedAt: number;
  tileSettleLatencyMs?: number;
  worldCenter: [number, number];
  zoom: number;
}

interface TileJobMetric {
  generation: number;
  latencyMs: number;
  outcome: "cancelled" | "failed" | "rendered";
  tile: string;
}

function round(value: number): number {
  return Math.round(value * 10) / 10;
}

function delay(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

function percentile(values: number[], quantile: number): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const index = Math.min(sorted.length - 1, Math.ceil(sorted.length * quantile) - 1);
  return round(sorted[index]!);
}

function tileKey(tile: Tile): string {
  return `${tile[2]}/${tile[0]}/${tile[1]}`;
}

function positiveInteger(value: string | undefined, fallback: number): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? Math.floor(parsed) : fallback;
}

const filePath = process.env["OSMIX_CLI_STRESS_PBF"];
if (!filePath) {
  console.log("Set OSMIX_CLI_STRESS_PBF to run the regional CLI stress harness.");
  process.exit(0);
}

const stageTimeoutMs = positiveInteger(
  process.env["OSMIX_CLI_STRESS_TIMEOUT_MS"],
  DEFAULT_STAGE_TIMEOUT_MS,
);
const file = await stat(filePath);
const capabilities = getOsmixCapabilities();
const startedAt = performance.now();
const rssBeforeRenderer = process.memoryUsage.rss();
let peakRssBytes = rssBeforeRenderer;
let previousHeartbeat = startedAt;
let maxHeartbeatGapMs = 0;
let maxMainLoopStallMs = 0;
let heartbeatTicks = 0;
let lastAnimationPhase = -1;
let lastAnimationPhaseAt = startedAt;
let maxAnimationPhaseGapMs = 0;
const animationPhases = new Set<number>();
const heartbeat = setInterval(() => {
  const now = performance.now();
  const heartbeatGap = now - previousHeartbeat;
  maxHeartbeatGapMs = Math.max(maxHeartbeatGapMs, heartbeatGap);
  maxMainLoopStallMs = Math.max(maxMainLoopStallMs, heartbeatGap - HEARTBEAT_INTERVAL_MS);
  previousHeartbeat = now;
  heartbeatTicks++;
  peakRssBytes = Math.max(peakRssBytes, process.memoryUsage.rss());

  const phase = Math.floor((now - startedAt) / ANIMATION_PHASE_MS);
  animationPhases.add(phase);
  if (phase !== lastAnimationPhase) {
    if (lastAnimationPhase !== -1) {
      maxAnimationPhaseGapMs = Math.max(maxAnimationPhaseGapMs, now - lastAnimationPhaseAt);
    }
    lastAnimationPhase = phase;
    lastAnimationPhaseAt = now;
  }
}, HEARTBEAT_INTERVAL_MS);

let progressEvents = 0;
let sharedTransferProgressEvents = 0;
let workerRestartProgressEvents = 0;
const rendererCreatedAt = performance.now();
const renderer = await createStyledTileRenderer({
  onProgress: (message) => {
    progressEvents++;
    if (message.includes("Sharing map indexes")) sharedTransferProgressEvents++;
    if (/restart/i.test(message)) workerRestartProgressEvents++;
  },
});
const rendererStartupMs = performance.now() - rendererCreatedAt;
let tileFailure: unknown;
const tileJobs: TileJobMetric[] = [];
let activeTileJobs = 0;

try {
  const loadStartedAt = performance.now();
  const info = await renderer.loadPbfFile(filePath, "regional-stress");
  const loadLatencyMs = performance.now() - loadStartedAt;
  const rssAfterLoadBytes = process.memoryUsage.rss();
  peakRssBytes = Math.max(peakRssBytes, rssAfterLoadBytes);
  const viewport: MapViewport = { width: 120, height: 78 };
  const camera = MapCamera.fitBounds(info.bbox, viewport);
  const revisions: RevisionMetric[] = [];
  const loader = new OsmTileLoader({
    maxConcurrentTiles: renderer.workerCount,
    onError: (error) => {
      tileFailure = error;
    },
    onGenerationChange: (generation) => renderer.cancelBefore(generation),
    renderTile: async (tile, generation) => {
      const tileStartedAt = performance.now();
      activeTileJobs++;
      try {
        const rendered = await renderer.renderTile(tile, generation);
        tileJobs.push({
          generation,
          latencyMs: performance.now() - tileStartedAt,
          outcome: rendered ? "rendered" : "cancelled",
          tile: tileKey(tile),
        });
        return rendered;
      } catch (error) {
        tileJobs.push({
          generation,
          latencyMs: performance.now() - tileStartedAt,
          outcome: "failed",
          tile: tileKey(tile),
        });
        throw error;
      } finally {
        activeTileJobs--;
      }
    },
  });

  const submitRevision = (name: string, revision: number): RevisionMetric => {
    const submittedAt = performance.now();
    const requestedTiles = new Set<string>();
    const pendingRegions: PendingTileRegion[] = [];
    loader.beginFrame(revision);
    renderMapPixels(
      camera,
      viewport,
      (tile): TileImage | null => {
        requestedTiles.add(tileKey(tile));
        return loader.getTile(tile);
      },
      pendingRegions,
    );
    loader.endFrame();
    const metric: RevisionMetric = {
      center: camera.center,
      initialPendingTiles: loader.pendingCount,
      name,
      pendingRegions: pendingRegions.length,
      requestedTiles,
      revision,
      submittedAt,
      worldCenter: [camera.centerX, camera.centerY],
      zoom: camera.zoom,
    };
    revisions.push(metric);
    return metric;
  };

  const waitUntil = async (description: string, ready: () => boolean): Promise<void> => {
    const deadline = performance.now() + stageTimeoutMs;
    while (!ready()) {
      if (tileFailure !== undefined) throw tileFailure;
      if (performance.now() > deadline) throw Error(`Timed out waiting for ${description}`);
      await delay(HEARTBEAT_INTERVAL_MS);
    }
    if (tileFailure !== undefined) throw tileFailure;
  };

  const waitForTiles = async (metric: RevisionMetric, includeStaleJobs = false): Promise<void> => {
    await waitUntil(
      `${metric.name} tiles`,
      () => loader.pendingCount === 0 && (!includeStaleJobs || activeTileJobs === 0),
    );
    metric.tileSettleLatencyMs = performance.now() - metric.submittedAt;
  };

  const queryLabels = async (metric: RevisionMetric): Promise<void> => {
    const labelStartedAt = performance.now();
    const result = await renderer.queryLabels({
      centerX: metric.worldCenter[0],
      centerY: metric.worldCenter[1],
      revision: metric.revision,
      viewport,
      zoom: metric.zoom,
    });
    metric.label = {
      candidates: result.candidates.length,
      latencyMs: performance.now() - labelStartedAt,
      revisionMatched: result.revision === metric.revision,
    };
    if (!metric.label.revisionMatched) {
      throw Error(`Label query returned revision ${result.revision}, expected ${metric.revision}`);
    }
  };

  const settleRevision = async (metric: RevisionMetric): Promise<void> => {
    if (renderer.labelsConcurrent) {
      await Promise.all([waitForTiles(metric), queryLabels(metric)]);
    } else {
      await waitForTiles(metric);
      await queryLabels(metric);
    }
  };

  let revision = 1;
  const fit = submitRevision("fit", revision++);
  await settleRevision(fit);

  while (camera.zoom < CLOSE_ZOOM) camera.zoomBy(1, viewport);
  const zoom = submitRevision("close-zoom", revision++);
  await settleRevision(zoom);

  const panDistance = TILE_SIZE * 1.25;
  const panDeltas: Array<[number, number]> = [
    [panDistance, 0],
    [panDistance, panDistance],
    [panDistance, -panDistance * 2],
    [-panDistance * 4, panDistance],
    [panDistance, panDistance * 2],
    [panDistance, panDistance],
  ];
  const panRevisions: RevisionMetric[] = [];
  for (const [index, delta] of panDeltas.entries()) {
    camera.panPixels(delta[0], delta[1]);
    panRevisions.push(submitRevision(`rapid-pan-${index + 1}`, revision++));
    if (index < panDeltas.length - 1) await delay(RAPID_PAN_DELAY_MS);
  }
  const finalPan = panRevisions.at(-1)!;
  if (renderer.labelsConcurrent) {
    await Promise.all([waitForTiles(finalPan, true), queryLabels(finalPan)]);
  } else {
    await waitForTiles(finalPan, true);
    await queryLabels(finalPan);
  }

  await waitUntil("all tile jobs", () => activeTileJobs === 0);
  loader.dispose();

  const finishedAt = performance.now();
  const elapsedMs = finishedAt - startedAt;
  const animationRateHz =
    elapsedMs > 0 ? Math.max(0, animationPhases.size - 1) / (elapsedMs / 1_000) : 0;
  const revisionResults = revisions.map((metric) => {
    const jobs = tileJobs.filter((job) => job.generation === metric.revision);
    const tileLatencies = jobs.map((job) => job.latencyMs);
    return {
      center: metric.center.map(round),
      initialPendingTiles: metric.initialPendingTiles,
      label: metric.label
        ? {
            ...metric.label,
            latencyMs: round(metric.label.latencyMs),
          }
        : null,
      name: metric.name,
      pendingRegions: metric.pendingRegions,
      requestedTiles: metric.requestedTiles.size,
      revision: metric.revision,
      tileJobs: {
        cancelled: jobs.filter((job) => job.outcome === "cancelled").length,
        failed: jobs.filter((job) => job.outcome === "failed").length,
        latencyMaxMs: tileLatencies.length > 0 ? round(Math.max(...tileLatencies)) : null,
        latencyP50Ms: percentile(tileLatencies, 0.5),
        latencyP95Ms: percentile(tileLatencies, 0.95),
        rendered: jobs.filter((job) => job.outcome === "rendered").length,
        started: jobs.length,
      },
      tileSettleLatencyMs:
        metric.tileSettleLatencyMs === undefined ? null : round(metric.tileSettleLatencyMs),
      zoom: metric.zoom,
    };
  });
  const rendererDiagnostics = renderer.diagnostics();
  const result = {
    animation: {
      distinctPhases: animationPhases.size,
      heartbeatTicks,
      maxAnimationPhaseGapMs: round(maxAnimationPhaseGapMs),
      maxHeartbeatGapMs: round(maxHeartbeatGapMs),
      maxMainLoopStallMs: round(maxMainLoopStallMs),
      phaseRateHz: round(animationRateHz),
    },
    elapsedMs: round(elapsedMs),
    fileBytes: file.size,
    labelsConcurrent: renderer.labelsConcurrent,
    loadLatencyMs: round(loadLatencyMs),
    memory: {
      peakRssBytes,
      rssAfterLoadBytes,
      rssAfterScenariosBytes: process.memoryUsage.rss(),
      rssBeforeRendererBytes: rssBeforeRenderer,
    },
    progressEvents,
    rendererStartupMs: round(rendererStartupMs),
    revisions: revisionResults,
    sharedBuffers: {
      capable: capabilities.canShareArrayBuffers,
      dataset: rendererDiagnostics.datasetBuffers,
      semanticIndexes: rendererDiagnostics.semanticIndexBuffers,
      sharedTransferProgressEvents,
    },
    stats: info.stats,
    workerCount: {
      tile: rendererDiagnostics.tileWorkerCount,
      total: rendererDiagnostics.totalWorkerCount,
    },
    workerRestarts: {
      progressEventsObserved: workerRestartProgressEvents,
      restartCount: rendererDiagnostics.restartCount,
    },
  };
  console.log(JSON.stringify(result, null, 2));

  if (maxMainLoopStallMs > MAX_MAIN_LOOP_STALL_MS) {
    throw Error(`Main event loop stalled for ${maxMainLoopStallMs.toFixed(1)}ms`);
  }
  if (maxAnimationPhaseGapMs > MAX_MAIN_LOOP_STALL_MS) {
    throw Error(`Animation heartbeat paused for ${maxAnimationPhaseGapMs.toFixed(1)}ms`);
  }
  if (elapsedMs >= 2_000 && animationRateHz < MIN_ANIMATION_RATE_HZ) {
    throw Error(`Animation heartbeat ran at only ${animationRateHz.toFixed(1)} phases/s`);
  }
  if (
    capabilities.canShareArrayBuffers &&
    rendererDiagnostics.totalWorkerCount > 1 &&
    (!rendererDiagnostics.datasetBuffers.allShared ||
      !rendererDiagnostics.semanticIndexBuffers.allShared)
  ) {
    throw Error("Multi-worker rendering did not retain shared dataset and semantic buffers");
  }
} finally {
  clearInterval(heartbeat);
  renderer.dispose();
}
