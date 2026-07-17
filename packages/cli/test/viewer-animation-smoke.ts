import { createTestRenderer } from "@opentui/core/testing";
import type { OsmInfo } from "osmix";

import type { StyledTileRenderer } from "../src/tile-renderer.ts";
import { animationPhase, TerminalMapViewer } from "../src/viewer.ts";

const SPINNER_FRAMES = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"] as const;
const SPINNER_PATTERN = /([⠋⠙⠹⠸⠼⠴⠦⠧⠇⠏]) (?:Rendering|Loading)/;
const TILE_PIXEL_BYTES = 256 * 256 * 4;

const info: OsmInfo = {
  id: "test-map",
  bbox: [7.4, 43.7, 7.5, 43.8],
  header: { optional_features: [], required_features: [] },
  stats: { nodes: 1_000, ways: 100, relations: 10 },
  spatialIndexes: { nodes: { all: true, tagged: true }, ways: true, relations: true },
};

function delay(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

function never<T>(): Promise<T> {
  return new Promise<T>(() => undefined);
}

async function waitFor(predicate: () => boolean, timeoutMs = 1_000): Promise<number> {
  const startedAt = performance.now();
  while (!predicate()) {
    if (performance.now() - startedAt > timeoutMs) throw Error("Timed out waiting for condition");
    await delay(5);
  }
  return performance.now() - startedAt;
}

function maximumGap(timestamps: number[]): number {
  let maximum = 0;
  for (let index = 1; index < timestamps.length; index++) {
    maximum = Math.max(maximum, timestamps[index]! - timestamps[index - 1]!);
  }
  return maximum;
}

let renderCalls = 0;
let labelCalls = 0;
let staticCompositions = 0;
const pending = await createTestRenderer({
  width: 48,
  height: 8,
  targetFps: 10,
  maxFps: 30,
});
const pendingTileRenderer: StyledTileRenderer = {
  labelsConcurrent: false,
  mode: "workers",
  workerCount: 1,
  cancelBefore: () => undefined,
  diagnostics: () => ({
    datasetBuffers: { allShared: false, referenceCount: 0, uniqueCount: 0 },
    restartCount: 0,
    semanticIndexBuffers: { allShared: false, referenceCount: 0, uniqueCount: 0 },
    tileWorkerCount: 1,
    totalWorkerCount: 1,
  }),
  dispose: () => undefined,
  loadPbfFile: () => never(),
  queryLabels: () => {
    labelCalls++;
    return never();
  },
  renderTile: () => {
    renderCalls++;
    return never();
  },
};
const pendingViewer = new TerminalMapViewer(
  pending.renderer,
  "regional.pbf",
  () => performance.now(),
  { onStaticCompose: () => staticCompositions++ },
);
pendingViewer.setDataset(info, pendingTileRenderer);

const spinnerPhases: string[] = [];
const shimmerFrames: string[] = [];
const animationTimestamps: number[] = [];
const recordAnimationFrame = () => {
  const frame = pending.captureCharFrame();
  const spinner = frame.match(SPINNER_PATTERN)?.[1];
  if (!spinner) return;
  spinnerPhases.push(spinner);
  shimmerFrames.push(JSON.stringify(pending.captureSpans().lines.slice(0, -1)));
  animationTimestamps.push(performance.now());
};
pending.renderer.on("frame", recordAnimationFrame);
await waitFor(() => renderCalls > 0 && animationTimestamps.length > 0);
spinnerPhases.length = 0;
shimmerFrames.length = 0;
animationTimestamps.length = 0;
const staticCompositionsBeforeAnimation = staticCompositions;
const renderCallsBeforeAnimation = renderCalls;
await delay(1_100);
pending.renderer.off("frame", recordAnimationFrame);
const staticCompositionsAfterAnimation = staticCompositions;

const centerBeforeInput = pendingViewer.camera.centerX;
const inputStartedAt = performance.now();
pending.mockInput.pressArrow("right");
const inputLatencyMs = await waitFor(() => pendingViewer.camera.centerX !== centerBeforeInput);
const inputHandledAt = performance.now() - inputStartedAt;

const zoomBeforeInput = pendingViewer.camera.zoom;
const zoomStartedAt = performance.now();
pending.mockInput.pressKey("+");
const zoomLatencyMs = await waitFor(() => pendingViewer.camera.zoom !== zoomBeforeInput);
const zoomHandledAt = performance.now() - zoomStartedAt;

const resizeStartedAt = performance.now();
pending.resize(60, 10);
const resizeLatencyMs = await waitFor(
  () =>
    pendingViewer.canvas.frameBuffer.width === 60 && pendingViewer.canvas.frameBuffer.height === 10,
);
const resizeHandledAt = performance.now() - resizeStartedAt;

const quitStartedAt = performance.now();
pending.mockInput.pressKey("q");
const quitLatencyMs = await waitFor(() => pending.renderer.isDestroyed);
const quitHandledAt = performance.now() - quitStartedAt;

const backpressured = await createTestRenderer({
  width: 48,
  height: 8,
  targetFps: 10,
  maxFps: 30,
});
type NativeRenderStatus = "backpressured" | "blocked" | "failed" | "rendered" | "retryable-skip";
const rendererInternals = backpressured.renderer as unknown as {
  renderNative: () => NativeRenderStatus;
};
const renderNative = rendererInternals.renderNative.bind(backpressured.renderer);
let acceptNativeFrames = false;
rendererInternals.renderNative = () => (acceptNativeFrames ? renderNative() : "backpressured");

let backpressureFrameEvents = 0;
let backpressureLabelCalls = 0;
let backpressureRenderCalls = 0;
let backpressureStaticCompositions = 0;
let completedTiles = 0;
backpressured.renderer.on("frame", () => backpressureFrameEvents++);
const backpressureTileRenderer: StyledTileRenderer = {
  labelsConcurrent: false,
  mode: "workers",
  workerCount: 1,
  cancelBefore: () => undefined,
  diagnostics: () => ({
    datasetBuffers: { allShared: false, referenceCount: 0, uniqueCount: 0 },
    restartCount: 0,
    semanticIndexBuffers: { allShared: false, referenceCount: 0, uniqueCount: 0 },
    tileWorkerCount: 1,
    totalWorkerCount: 1,
  }),
  dispose: () => undefined,
  loadPbfFile: () => never(),
  queryLabels: () => {
    backpressureLabelCalls++;
    return never();
  },
  renderTile: async () => {
    backpressureRenderCalls++;
    await delay(20);
    completedTiles++;
    return { data: new Uint8ClampedArray(TILE_PIXEL_BYTES) };
  },
};
const backpressureViewer = new TerminalMapViewer(
  backpressured.renderer,
  "regional.pbf",
  () => performance.now(),
  { onStaticCompose: () => backpressureStaticCompositions++ },
);
backpressureViewer.setDataset(info, backpressureTileRenderer);
await delay(450);
const frameEventsWhileBackpressured = backpressureFrameEvents;

const resumedFrame = new Promise<{ frame: string; timestamp: number }>((resolve) => {
  backpressured.renderer.once("frame", () =>
    resolve({ frame: backpressured.captureCharFrame(), timestamp: performance.now() }),
  );
});
acceptNativeFrames = true;
backpressured.renderer.requestRender();
const resumed = await Promise.race([
  resumedFrame,
  delay(1_000).then(() => {
    throw Error("Timed out waiting for output to resume");
  }),
]);
const resumedSpinner = resumed.frame.match(SPINNER_PATTERN)?.[1];
const expectedSpinner = SPINNER_FRAMES[animationPhase(resumed.timestamp) % SPINNER_FRAMES.length];
const previousSpinner =
  SPINNER_FRAMES[
    (animationPhase(resumed.timestamp) - 1 + SPINNER_FRAMES.length) % SPINNER_FRAMES.length
  ];
backpressured.renderer.destroy();

console.log(
  JSON.stringify({
    animationFrameCount: animationTimestamps.length,
    backpressureFrameEvents: frameEventsWhileBackpressured,
    backpressureLabelCalls,
    backpressureRenderCalls,
    backpressureStaticCompositions,
    completedTiles,
    distinctShimmerFrames: new Set(shimmerFrames).size,
    distinctSpinnerPhases: new Set(spinnerPhases).size,
    finalRenderCalls: renderCalls,
    inputHandled: inputHandledAt < 250 && inputLatencyMs < 250,
    labelCalls,
    maxAnimationGapMs: maximumGap(animationTimestamps),
    quitHandled: quitHandledAt < 250 && quitLatencyMs < 250,
    renderCallsBeforeAnimation,
    resizeHandled: resizeHandledAt < 250 && resizeLatencyMs < 250,
    resumedAtClockPhase: resumedSpinner === expectedSpinner || resumedSpinner === previousSpinner,
    staticCompositionsAfterAnimation,
    staticCompositionsBeforeAnimation,
    zoomHandled: zoomHandledAt < 250 && zoomLatencyMs < 250,
  }),
);
